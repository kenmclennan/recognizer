import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Violation } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import {
  check,
  InputError,
  parsePolicy,
  ruleText,
  validateScan,
} from "../src/index.js";
import { FIXTURE, REPO } from "./helpers.js";

const POLICY = `
forbid:
  - from: [d/**]
    to: [p/**, a/**, x/**, main.py]
  - from: [p/**]
    to: [a/**, x/**, main.py]
  - from: [a/**]
    to: [x/**, main.py]
  - from: [x/**]
    to: [main.py]
  - "x/* -> x/*"
  - "* -> foreign:requests"
ignore: [tests/**]
`;

function scanOf(edges: object[], modules: string[] = []) {
  return {
    schema_version: 7,
    scanner: { name: "t", version: "0" },
    commit: null,
    modified: false,
    files: [],
    selection: {
      extensions: [],
      skip_directory_names: [],
      skip_directory_prefixes: [],
      skip_directory_suffixes: [],
      skip_directories_containing: [],
      skip_file_globs: [],
    },
    modules: modules.map((id) => ({
      id,
      language: "python",
      kind: "module",
      members: [],
    })),
    edges,
    foreign: [
      { id: "foreign:requests", name: "requests" },
      { id: "foreign:os", name: "os" },
    ],
  };
}

function edge(from: string, to: string, kind = "depends", line = 1) {
  return kind === "depends"
    ? { from, to, kind, line }
    : { from, to, kind, line, member: "M", to_member: "T" };
}

function run(edges: object[], policy = POLICY, modules: string[] = []) {
  return check(scanOf(edges, modules), parsePolicy(policy), null);
}

describe("list forbid rule", () => {
  it.each(["depends", "inherits", "implements"])(
    "flags an import from a from glob to a to glob for %s",
    (kind) => {
      expect(run([edge("d/a.py", "x/b.py", kind)]).violations).toHaveLength(1);
    },
  );

  it("allows an import no rule names", () => {
    expect(
      run([edge("d/a.py", "d/b.py"), edge("x/a.py", "d/b.py")]).violations,
    ).toEqual([]);
  });

  it("never flags a self-edge", () => {
    expect(run([edge("d/a.py", "d/a.py")]).violations).toEqual([]);
  });

  it("checks endpoints that are not listed in modules", () => {
    expect(run([edge("d/a.py", "x/b.py")], POLICY, []).violations).toHaveLength(
      1,
    );
  });

  it("drops edges touching an ignored module", () => {
    expect(run([edge("d/a.py", "tests/b.py")]).violations).toEqual([]);
  });
});

describe("forbid rule", () => {
  it("fires on a module target", () => {
    const result = run([edge("x/a.py", "x/b.py")]);

    expect(result.violations[0]?.rule).toEqual({
      type: "forbid",
      pattern: "x/* -> x/*",
    });
  });

  it("fires on a foreign target only when named", () => {
    expect(run([edge("x/a.py", "foreign:requests")]).violations).toHaveLength(
      1,
    );
    expect(run([edge("x/a.py", "foreign:os")]).violations).toEqual([]);
  });

  it("yields one violation per rule when an edge hits two rules", () => {
    const result = run([
      edge("d/a.py", "foreign:requests"),
      edge("x/a.py", "x/b.py"),
    ]);
    const both = run(
      [edge("d/a.py", "x/b.py")],
      `${POLICY.replace("x/* -> x/*", "d/* -> x/*")}`,
    );

    expect(result.violations).toHaveLength(2);
    expect(both.violations).toHaveLength(2);
    expect(both.violations.map((v) => ruleText(v.rule))).toEqual([
      "forbid d/* -> x/*",
      "forbid d/** -> p/**, a/**, x/**, main.py",
    ]);
    expect(both.violations.map((v) => v.dependencies)).toEqual([
      [{ to: "x/b.py", kind: "depends", lines: [1] }],
      [{ to: "x/b.py", kind: "depends", lines: [1] }],
    ]);
  });

  it("merges edges sharing an identity into sorted lines", () => {
    const result = run([
      edge("x/a.py", "x/b.py", "depends", 9),
      edge("x/a.py", "x/b.py", "depends", 2),
    ]);

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.dependencies).toEqual([
      { to: "x/b.py", kind: "depends", lines: [2, 9] },
    ]);
  });

  it("groups two imports from one module under one rule into one violation", () => {
    const result = run([
      edge("d/a.py", "x/m1.py", "depends", 3),
      edge("d/a.py", "x/m2.py", "depends", 7),
    ]);

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.file).toBe("d/a.py");
    expect(ruleText((result.violations[0] as Violation).rule)).toBe(
      "forbid d/** -> p/**, a/**, x/**, main.py",
    );
    expect(result.violations[0]?.dependencies).toEqual([
      { to: "x/m1.py", kind: "depends", lines: [3] },
      { to: "x/m2.py", kind: "depends", lines: [7] },
    ]);
  });

  it("keeps different rules and different source modules apart", () => {
    const rules = run([
      edge("d/a.py", "x/m1.py"),
      edge("d/a.py", "foreign:requests"),
    ]);
    const modules = run([edge("d/a.py", "x/m1.py"), edge("d/b.py", "x/m1.py")]);

    expect(rules.violations).toHaveLength(2);
    expect(modules.violations).toHaveLength(2);
    expect(modules.violations.map((v) => v.file)).toEqual(["d/a.py", "d/b.py"]);
  });
});

describe("baseline over grouped violations", () => {
  const known = (to: string) => ({ from: "d/a.py", to, kind: "depends" });

  it("treats a second import under a rule the module already breaks as growth", () => {
    const result = run(
      [edge("d/a.py", "x/m1.py"), edge("d/a.py", "x/m2.py")],
      POLICY,
      [],
    );
    const ranked = check(
      scanOf([edge("d/a.py", "x/m1.py"), edge("d/a.py", "x/m2.py")]),
      parsePolicy(POLICY),
      [known("x/m1.py")],
    );

    expect(result.new).toHaveLength(1);
    expect(ranked.violations).toHaveLength(1);
    expect(ranked.new).toHaveLength(1);
    expect(ranked.new[0]?.grown).toBe(true);
    expect(ranked.new[0]?.dependencies.map((one) => one.to)).toEqual([
      "x/m2.py",
    ]);
    expect(ranked.fixed).toEqual([]);
  });

  it("accepts an import already in the baseline and reports the others under the one rule", () => {
    const ranked = check(
      scanOf([
        edge("d/a.py", "x/m1.py"),
        edge("d/a.py", "x/m2.py"),
        edge("d/a.py", "p/s.py"),
      ]),
      parsePolicy(POLICY),
      [known("x/m1.py")],
    );

    expect(ranked.new).toHaveLength(1);
    expect(ranked.new[0]?.grown).toBe(true);
    expect(ranked.new[0]?.dependencies.map((one) => one.to)).toEqual([
      "p/s.py",
      "x/m2.py",
    ]);
    expect(ranked.fixed).toEqual([]);
  });

  it("matches an old per-edge baseline of either spelling", () => {
    const scan = scanOf([edge("d/a.py", "x/m1.py")]);

    for (const baseline of [
      [known("x/m1.py")],
      [{ id: "rule-violation:depends:d/a.py->x/m1.py" }],
    ]) {
      const ranked = check(
        scan,
        parsePolicy(POLICY),
        baseline as { from: string; to: string; kind: string }[],
      );

      expect(ranked.violations).toHaveLength(1);
      expect(ranked.new).toEqual([]);
      expect(ranked.fixed).toEqual([]);
    }
  });

  it("reports a removed import as fixed while the finding stays", () => {
    const ranked = check(
      scanOf([edge("d/a.py", "x/m1.py")]),
      parsePolicy(POLICY),
      [known("x/m1.py"), known("x/m2.py")],
    );

    expect(ranked.violations).toHaveLength(1);
    expect(ranked.new).toEqual([]);
    expect(ranked.fixed).toEqual([known("x/m2.py")]);
  });
});

function violatingImports(edges: object[], policy: string) {
  return run(edges, policy).violations.flatMap((violation) =>
    violation.dependencies.map((one) => [violation.file, one.to]),
  );
}

const LIST_RULE = "forbid:\n  - from: [a/**, b/**]\n    to: [c/**, d/**]\n";

describe("forbid rule forms", () => {
  it("list forbid rule reports every matching import and only those", () => {
    const edges = [
      edge("a/1.py", "c/1.py"),
      edge("a/1.py", "d/1.py"),
      edge("b/1.py", "c/1.py"),
      edge("b/1.py", "x/1.py"),
      edge("e/1.py", "c/1.py"),
    ];

    expect(scanOf(edges).edges).toHaveLength(5);
    expect(violatingImports(edges, LIST_RULE)).toEqual([
      ["a/1.py", "c/1.py"],
      ["a/1.py", "d/1.py"],
      ["b/1.py", "c/1.py"],
    ]);
  });

  it("string forbid rule still reports its one-to-one imports", () => {
    const policy = "forbid: ['a/* -> b/*']\n";
    const edges = [
      edge("a/1.py", "b/1.py"),
      edge("b/1.py", "a/1.py"),
      edge("a/1.py", "c/1.py"),
    ];

    expect(violatingImports(edges, policy)).toEqual([["a/1.py", "b/1.py"]]);
  });

  it("groups a file importing two to targets of one list rule into one violation", () => {
    const result = run(
      [edge("a/1.py", "c/1.py"), edge("a/1.py", "d/1.py")],
      LIST_RULE,
    );

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.dependencies.map((one) => one.to)).toEqual([
      "c/1.py",
      "d/1.py",
    ]);
  });

  it("accepts a single glob for from and to in a mapping rule", () => {
    expect(
      violatingImports(
        [edge("a/1.py", "b/1.py")],
        "forbid:\n  - from: a/**\n    to: b/**\n",
      ),
    ).toEqual([["a/1.py", "b/1.py"]]);
  });

  it("names a list rule by its globs", () => {
    const result = run([edge("a/1.py", "c/1.py")], LIST_RULE);

    expect(ruleText((result.violations[0] as Violation).rule)).toBe(
      "forbid a/**, b/** -> c/**, d/**",
    );
  });

  it("never compares a module no rule names", () => {
    expect(violatingImports([edge("zzz/x.py", "a/y.py")], LIST_RULE)).toEqual(
      [],
    );
  });

  it("sorts one module's violations by rule text", () => {
    const policy = "forbid: ['d/* -> *', 'd/* -> e/*']\n";
    const result = run([edge("d/x.py", "e/y.py")], policy);

    expect(result.violations.map((v) => ruleText(v.rule))).toEqual([
      "forbid d/* -> *",
      "forbid d/* -> e/*",
    ]);
  });
});

describe("a findings file written before the upgrade", () => {
  it("still names a level and a uses rule", () => {
    expect(
      ruleText({
        type: "level",
        fromLevel: "domain",
        toLevel: "ports",
      }),
    ).toBe("level domain -> ports");
    expect(
      ruleText({
        type: "uses",
        fromComponent: "orders",
        toComponent: "billing",
      }),
    ).toBe("uses orders -> billing");
  });
});

describe("policy validation", () => {
  it("accepts a policy with only forbid", () => {
    expect(() => parsePolicy("forbid: ['* -> foreign:x']\n")).not.toThrow();
  });

  it.each([
    ["unknown top-level key", "extra: 1\n"],
    ["modules key", "modules:\n  a: x/**\n"],
    ["forbid without arrow", "forbid: [nope]\n"],
    ["non-list ignore", "ignore: x\n"],
    ["non-list entry", "entry: x\n"],
    ["empty entry glob", 'entry: [""]\n'],
  ])("rejects %s", (_name, text) => {
    expect(() => parsePolicy(text)).toThrow(InputError);
  });

  it("collects one message per fault", () => {
    try {
      parsePolicy("extra: 1\nforbid: [x]\nignore: y\n");
      expect.unreachable();
    } catch (error) {
      expect((error as InputError).messages).toHaveLength(3);
    }
  });
});

describe("committed content", () => {
  const examples = (kind: string) =>
    readdirSync(join(REPO, "schema/examples", kind)).map((name) =>
      JSON.parse(
        readFileSync(join(REPO, "schema/examples", kind, name), "utf8"),
      ),
    );

  it("accepts every valid example scan", () => {
    for (const scan of examples("valid")) {
      expect(() => validateScan(scan)).not.toThrow();
    }
  });

  it("rejects every invalid example scan", () => {
    for (const scan of examples("invalid")) {
      expect(() => validateScan(scan)).toThrow(InputError);
    }
  });

  it("finds no violations in the design example", () => {
    const scan = JSON.parse(
      readFileSync(
        join(REPO, "schema/examples/valid/design-example.json"),
        "utf8",
      ),
    );
    const policy = parsePolicy(`
forbid:
  - from: [lightcycle/domain/**]
    to: [lightcycle/ports/**, lightcycle/application/**, lightcycle/adapters/**]
  - from: [lightcycle/ports/**]
    to: [lightcycle/application/**, lightcycle/adapters/**]
  - from: [lightcycle/application/**]
    to: [lightcycle/adapters/**]
`);
    const result = check(scan, policy, null);

    expect(result.violations).toEqual([]);
  });

  it("validates the check fixture scan", () => {
    const scan = JSON.parse(readFileSync(join(FIXTURE, "scan.json"), "utf8"));

    expect(() => validateScan(scan)).not.toThrow();
  });

  it("yields no violations when everything is ignored", () => {
    const result = run(
      [edge("d/a.py", "x/b.py")],
      `${POLICY}`.replace("ignore: [tests/**]", 'ignore: ["**"]'),
    );

    expect(result.violations).toEqual([]);
  });
});
