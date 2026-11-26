import { beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_STRUCTURE_SETTINGS,
  type Finding,
  type GrammarRule,
  grammarFor,
  Member,
  measureSource,
  type Parsers,
  runStructureAnalysis,
  type StructureSettings,
} from "../../src/index.js";
import {
  allParsers,
  GRAMMAR_RULES,
  measuredSources,
  ROOT,
  readFixture,
} from "./measured-sources.js";

let parsers: Parsers;

beforeAll(async () => {
  parsers = await allParsers();
});

function duplicatedLines(findings: readonly Finding[]): Record<string, number> {
  const lines = new Map<string, Set<number>>();

  for (const finding of findings) {
    for (const member of finding.members ?? []) {
      if (member.lines === undefined) {
        continue;
      }

      const held = lines.get(member.file) ?? new Set<number>();

      for (let line = member.lines[0]; line <= member.lines[1]; line += 1) {
        held.add(line);
      }

      lines.set(member.file, held);
    }
  }

  return Object.fromEntries(
    [...lines].map(([module, held]) => [module, held.size]),
  );
}

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
  members: Record<string, Member[]> = {},
) {
  const { fakes, scans, say } = measuredSources(files, members);
  const run = runStructureAnalysis(fakes, {
    say,
    root: ROOT,
    repository: scans,
    policy: null,
    settings: {
      ...DEFAULT_STRUCTURE_SETTINGS,
      duplication: false,
      ...overrides,
    },
    parsers: withParsers,
    rules: GRAMMAR_RULES,
  });
  const [written] = fakes.findings.overlays;
  const overlay =
    written === undefined
      ? null
      : {
          values: {
            ...(written.complexity === null
              ? {}
              : { complexity: written.complexity }),
            function_length: written.functionLength,
            ...(written.duplication === null
              ? {}
              : { duplication: duplicatedLines(written.duplication) }),
          } as Record<string, Record<string, number>>,
          written,
        };

  return { fakes, run, overlay };
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
    expect(overlay?.written.commit).toBe("c1");
  });

  it("writes function_length by the long_function rule", () => {
    const { overlay } = sense({ "a.py": branches("f", 2) }, {}, parsers, {
      "a.py": [
        new Member({
          kind: "function",
          name: "f",
          exported: true,
          line: 1,
          bodyLine: 2,
          endLine: 31,
        }),
        new Member({
          kind: "class",
          name: "K",
          exported: true,
          methods: [{ name: "m", line: 40, bodyLine: 41, endLine: 44 }],
        }),
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
  });

  it("leaves the metric out of values when its setting is off", () => {
    const { overlay } = sense(
      { "a.py": branches("f", 12) },
      {
        warnings: { ...DEFAULT_STRUCTURE_SETTINGS.warnings, complexity: false },
      },
    );

    expect(overlay?.written.complexity).toBeNull();
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
    const source = readFixture(`fixtures/duplication/sample/${path}`);
    const { overlay } = sense({ [path]: source });
    const rule = grammarFor(path, GRAMMAR_RULES) as GrammarRule;
    const functions = measureSource(path, source, rule, parsers);

    expect(functions.length).toBeGreaterThan(0);
    expect(Object.keys(overlay?.values.complexity ?? {})).toHaveLength(
      new Set(functions.map((one) => one.qualified)).size,
    );
    expect(overlay?.written).toMatchObject({ commit: "c1", modified: false });
  });
});
