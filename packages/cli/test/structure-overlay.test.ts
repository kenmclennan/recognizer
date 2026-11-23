import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_STRUCTURE_SETTINGS,
  grammarFor,
  measureSource,
  type Parsers,
  runStructureAnalysis,
  type StructureSettings,
} from "@recognizer/core";
import { beforeAll, describe, expect, it } from "vitest";
import type { DocumentMember } from "../src/adapters/filesystem/scan-document-types.js";
import { memberOf } from "../src/adapters/filesystem/scan-translator.js";
import { type Overlay, validateOverlay } from "../src/overlays.js";
import {
  STRUCTURE_OVERLAY_METRICS,
  structureOverlayFile,
} from "../src/structure-overlay.js";
import { analysisPortsOf, sayOf } from "./analysis-ports.js";
import { allParsers, measuredSources, ROOT } from "./duplication-helpers.js";
import { REPO } from "./helpers.js";

let parsers: Parsers;

beforeAll(async () => {
  parsers = await allParsers();
});

function branches(name: string, count: number): string {
  const body = Array.from(
    { length: count },
    (_, index) => `    if x == ${index}:\n        y = ${index}`,
  ).join("\n");

  return `def ${name}(x):\n    y = 0\n${body}\n    return y\n`;
}

function sense(
  files: Record<string, string>,
  overrides: Partial<StructureSettings> = {},
  withParsers: Parsers | null = parsers,
  members: Record<string, unknown[]> = {},
) {
  const { fake, scans } = measuredSources(files);

  for (const file of scans.files) {
    (file as { members: unknown }).members = (
      (members[file.path] ?? []) as DocumentMember[]
    ).map(memberOf);
  }

  const run = runStructureAnalysis(analysisPortsOf(fake.io), {
    say: sayOf(fake.io),
    root: ROOT,
    repository: scans,
    policy: null,
    settings: {
      ...DEFAULT_STRUCTURE_SETTINGS,
      duplication: false,
      ...overrides,
    },
    parsers: withParsers,
  });
  const text = fake.files.get(structureOverlayFile(ROOT));
  const overlay = text === undefined ? null : (JSON.parse(text) as Overlay);

  return { fake, run, overlay };
}

describe("the structural analysis overlay", () => {
  it("writes complexity for every function and findings only for those over the limit", () => {
    const { run, overlay } = sense({
      "a.py": `${branches("low", 2)}\n${branches("above", 10)}`,
    });

    expect(overlay?.values.complexity).toEqual({
      "a.py::low": 3,
      "a.py::above": 11,
    });
    expect(
      run.sensed.document.findings
        .filter((finding) => finding.kind === "complexity")
        .map((finding) => finding.id),
    ).toEqual(["complexity:a.py::above"]);
    expect(overlay?.metrics).toEqual(STRUCTURE_OVERLAY_METRICS);
    expect(overlay?.producer.name).toBe("recognizer");
  });

  it("writes function_length by the long_function rule", () => {
    const { overlay } = sense({ "a.py": branches("f", 2) }, {}, parsers, {
      "a.py": [
        {
          kind: "function",
          name: "f",
          exported: true,
          line: 1,
          body_line: 2,
          end_line: 31,
        },
        {
          kind: "class",
          name: "K",
          exported: true,
          methods: [{ name: "m", line: 40, body_line: 41, end_line: 44 }],
        },
      ],
    });

    expect(overlay?.values.function_length).toEqual({
      "a.py::f": 30,
      "a.py::K.m": 4,
    });
  });

  it("writes duplication as the lines inside a duplicated function", () => {
    const body = (name: string) =>
      [
        `def ${name}(items, rate):`,
        "    total = 0",
        "    for item in items:",
        "        if item.price > 100:",
        "            total += item.price * rate",
        "        else:",
        "            total += item.price",
        "    return total",
        "",
      ].join("\n");
    const { overlay } = sense(
      { "a.py": body("alpha"), "b.py": body("beta") },
      { duplication: { ...DEFAULT_STRUCTURE_SETTINGS.duplication } as never },
    );

    expect(overlay?.values.duplication).toEqual({ "a.py": 8, "b.py": 8 });
    expect(
      overlay?.metrics.find((metric) => metric.name === "duplication")
        ?.granularity,
    ).toBe("module");
  });

  it("leaves the metric out of values when its setting is off", () => {
    const { overlay } = sense(
      { "a.py": branches("f", 12) },
      {
        warnings: { ...DEFAULT_STRUCTURE_SETTINGS.warnings, complexity: false },
      },
    );

    expect(overlay?.metrics.map((metric) => metric.name)).toEqual([
      "complexity",
      "function_length",
      "duplication",
    ]);
    expect(overlay?.values).not.toHaveProperty("complexity");
    expect(overlay?.values).not.toHaveProperty("duplication");
    expect(overlay?.values).toHaveProperty("function_length");
  });

  it("writes no overlay without parsers", () => {
    const { overlay, run } = sense({ "a.py": branches("f", 12) }, {}, null);

    expect(run.error).toBeNull();
    expect(overlay).toBeNull();
  });

  it("measures real committed content and validates", () => {
    const path = "app/pricing.py";
    const source = readFileSync(
      join(REPO, "fixtures/duplication/sample", path),
      "utf8",
    );
    const { overlay } = sense({ [path]: source });
    const grammar = grammarFor(path);
    const functions = measureSource(path, source, grammar as never, parsers);

    expect(functions.length).toBeGreaterThan(0);
    expect(Object.keys(overlay?.values.complexity ?? {})).toHaveLength(
      new Set(functions.map((one) => one.qualified)).size,
    );
    expect(() =>
      validateOverlay(overlay, {
        commit: "c1",
        modified: false,
        metrics: STRUCTURE_OVERLAY_METRICS,
      }),
    ).not.toThrow();
  });
});
