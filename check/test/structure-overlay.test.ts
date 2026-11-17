import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { measureSource } from "../src/complexity/measure.js";
import { grammarFor } from "../src/duplication/grammars.js";
import type { Parsers } from "../src/duplication/parsers.js";
import { type Overlay, validateOverlay } from "../src/overlays.js";
import {
  STRUCTURE_OVERLAY_METRICS,
  structureOverlayFile,
} from "../src/structure-overlay.js";
import { runStructureSensor } from "../src/structure-run.js";
import {
  DEFAULT_STRUCTURE_SETTINGS,
  type StructureSettings,
} from "../src/structure-sensor.js";
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

  for (const scan of scans) {
    for (const module of scan.modules) {
      (module as { members?: unknown[] }).members = members[module.id] ?? [];
    }
  }

  const run = runStructureSensor(
    fake.io,
    ROOT,
    scans,
    null,
    { ...DEFAULT_STRUCTURE_SETTINGS, duplication: false, ...overrides },
    withParsers,
  );
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
      "duplication",
    ]);
    expect(overlay?.values).not.toHaveProperty("complexity");
    expect(overlay?.values).not.toHaveProperty("duplication");
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
