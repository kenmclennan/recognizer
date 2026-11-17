import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  check,
  InputError,
  parsePolicy,
  ruleText,
  type Violation,
  validateScan,
} from "../src/index.js";
import { FIXTURE, REPO } from "./helpers.js";

const POLICY = `
levels: [domain, ports, application, adapters, entry]
components:
  domain: d/**
  ports: p/**
  application: a/**
  adapters: x/**
  entry: [main.py]
forbid:
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

describe("level rule", () => {
  it.each(["depends", "inherits", "implements"])(
    "flags inner to outer for %s",
    (kind) => {
      expect(run([edge("d/a.py", "x/b.py", kind)]).violations).toHaveLength(1);
    },
  );

  it("allows same level and outer to inner", () => {
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

  it("yields one violation per rule when an edge hits level and forbid", () => {
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
      "level domain -> adapters",
    ]);
    expect(both.violations.map((v) => v.imports)).toEqual([
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
    expect(result.violations[0]?.imports).toEqual([
      { to: "x/b.py", kind: "depends", lines: [2, 9] },
    ]);
  });

  it("groups two imports from one module under one rule into one violation", () => {
    const result = run([
      edge("d/a.py", "x/m1.py", "depends", 3),
      edge("d/a.py", "x/m2.py", "depends", 7),
    ]);

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.from).toBe("d/a.py");
    expect(ruleText((result.violations[0] as Violation).rule)).toBe(
      "level domain -> adapters",
    );
    expect(result.violations[0]?.imports).toEqual([
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
    expect(modules.violations.map((v) => v.from)).toEqual(["d/a.py", "d/b.py"]);
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
    expect(ranked.new[0]?.imports.map((one) => one.to)).toEqual(["x/m2.py"]);
    expect(ranked.fixed).toEqual([]);
  });

  it("accepts an import already in the baseline and reports a new rule", () => {
    const ranked = check(
      scanOf([
        edge("d/a.py", "x/m1.py"),
        edge("d/a.py", "x/m2.py"),
        edge("d/a.py", "p/s.py"),
      ]),
      parsePolicy(POLICY),
      [known("x/m1.py")],
    );
    const byRule = (text: string) =>
      ranked.new.find((v) => ruleText(v.rule) === text);

    expect(ranked.new).toHaveLength(2);
    expect(byRule("level domain -> adapters")?.grown).toBe(true);
    expect(
      byRule("level domain -> adapters")?.imports.map((one) => one.to),
    ).toEqual(["x/m2.py"]);
    expect(byRule("level domain -> ports")?.grown).toBeUndefined();
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

const MIXED = `
components:
  domain: d/**
  ports: p/**
  application: a/**
  extras: e/**
  idle: i/**
levels: [domain, ports, application]
uses:
  domain: [ports]
  extras: [domain]
`;

const USES_ONLY = `
components:
  shared: s/**
  orders: o/**
  billing: b/**
uses:
  orders: [shared]
  billing: [shared]
  shared: []
`;

function ruleOf(edges: object[], policy: string) {
  return run(edges, policy).violations.map((v) => [v.rule]);
}

describe("component rule", () => {
  it("permits outer to inner", () => {
    expect(ruleOf([edge("a/x.py", "d/y.py")], MIXED)).toEqual([]);
  });

  it("does not compare two modules of one component", () => {
    expect(ruleOf([edge("d/x.py", "d/y.py")], MIXED)).toEqual([]);
  });

  it("permits through uses what the order forbids", () => {
    expect(ruleOf([edge("d/x.py", "p/y.py")], MIXED)).toEqual([]);
  });

  it("flags inner to outer as a level rule", () => {
    expect(ruleOf([edge("d/x.py", "a/y.py")], MIXED)).toEqual([
      [{ type: "level", from_level: "domain", to_level: "application" }],
    ]);
  });

  it("flags the adjacent inner to outer pair and permits the reverse", () => {
    expect(ruleOf([edge("p/x.py", "a/y.py")], MIXED)).toHaveLength(1);
    expect(ruleOf([edge("a/x.py", "p/y.py")], MIXED)).toEqual([]);
  });

  it("permits a component outside levels through uses", () => {
    expect(ruleOf([edge("e/x.py", "d/y.py")], MIXED)).toEqual([]);
  });

  it("flags a component outside levels as a uses rule", () => {
    expect(ruleOf([edge("e/x.py", "p/y.py")], MIXED)).toEqual([
      [{ type: "uses", from_component: "extras", to_component: "ports" }],
    ]);
  });

  it("flags a ranked source reaching a component outside levels", () => {
    expect(ruleOf([edge("d/x.py", "e/y.py")], MIXED)).toEqual([
      [{ type: "uses", from_component: "domain", to_component: "extras" }],
    ]);
  });

  it("never compares a module in no component", () => {
    expect(ruleOf([edge("zzz/x.py", "d/y.py")], MIXED)).toEqual([]);
  });

  it("works with uses alone", () => {
    expect(ruleOf([edge("o/x.py", "s/y.py")], USES_ONLY)).toEqual([]);
    expect(ruleOf([edge("o/x.py", "b/y.py", "inherits")], USES_ONLY)).toEqual([
      [{ type: "uses", from_component: "orders", to_component: "billing" }],
    ]);
    expect(ruleOf([edge("s/x.py", "o/y.py")], USES_ONLY)).toHaveLength(1);
  });

  it("fires only forbid when the policy has neither levels nor uses", () => {
    const policy =
      "components:\n  a: a/**\n  b: b/**\nforbid: ['a/* -> b/*']\n";

    expect(ruleOf([edge("b/x.py", "a/y.py")], policy)).toEqual([]);
    expect(ruleOf([edge("a/x.py", "b/y.py")], policy)).toEqual([
      [{ type: "forbid", pattern: "a/* -> b/*" }],
    ]);
  });

  it("sorts one module's violations by rule text", () => {
    const policy = `${MIXED}forbid: ['d/* -> *']\n`;
    const result = run(
      [edge("d/x.py", "a/y.py"), edge("d/x.py", "e/y.py")],
      policy,
    );

    expect(result.violations.map((v) => ruleText(v.rule))).toEqual([
      "forbid d/* -> *",
      "level domain -> application",
      "uses domain -> extras",
    ]);
  });
});

describe("unranked", () => {
  it("does not count a module in a component outside levels and uses", () => {
    const policy = "components:\n  a: a/**\n  b: b/**\nlevels: [a]\n";

    expect(run([edge("b/x.py", "a/y.py")], policy, ["b/x.py"]).unranked).toBe(
      0,
    );
  });

  it("counts distinct unranked modules and still checks ranked ones", () => {
    const result = run(
      [edge("d/a.py", "x/b.py"), edge("other/a.py", "d/a.py")],
      POLICY,
      ["other/a.py", "other/z.py"],
    );

    expect(result.unranked).toBe(2);
    expect(result.violations).toHaveLength(1);
  });

  it("is zero when everything resolves", () => {
    expect(run([edge("d/a.py", "d/b.py")]).unranked).toBe(0);
  });

  it("is the module count with no level violations when nothing resolves", () => {
    const result = run([edge("q/a.py", "r/b.py")], POLICY, [
      "q/a.py",
      "r/b.py",
    ]);

    expect(result.unranked).toBe(2);
    expect(result.violations).toEqual([]);
  });

  it("rejects a module matching two components", () => {
    const policy =
      "levels: [one, two]\ncomponents:\n  one: a/**\n  two: a/b/**\n";

    expect(() => run([edge("a/b/c.py", "a/d.py")], policy)).toThrow(/one, two/);
  });
});

describe("policy validation", () => {
  it("accepts a policy with only forbid", () => {
    expect(() => parsePolicy("forbid: ['* -> foreign:x']\n")).not.toThrow();
  });

  it("accepts a component that lists itself in uses", () => {
    expect(() =>
      parsePolicy("components:\n  a: x/**\nuses:\n  a: [a]\n"),
    ).not.toThrow();
  });

  it.each([
    ["unknown top-level key", "extra: 1\n"],
    ["empty levels", "levels: []\n"],
    ["duplicate level", "levels: [a, a]\n"],
    ["modules key", "modules:\n  a: x/**\n"],
    [
      "levels name not in components",
      "components:\n  a: x/**\nlevels: [a, b]\n",
    ],
    ["uses key not in components", "components:\n  a: x/**\nuses:\n  b: [a]\n"],
    [
      "uses value not in components",
      "components:\n  a: x/**\nuses:\n  a: [b]\n",
    ],
    ["uses not a map", "components:\n  a: x/**\nuses: [a]\n"],
    ["uses value not a list", "components:\n  a: x/**\nuses:\n  a: a\n"],
    ["empty uses", "components:\n  a: x/**\nuses: {}\n"],
    ["forbid without arrow", "forbid: [nope]\n"],
    ["empty glob", 'components:\n  a: ""\n'],
    ["non-list ignore", "ignore: x\n"],
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
levels: [domain, ports, application, adapters, entry]
components:
  domain: lightcycle/domain/**
  ports: lightcycle/ports/**
  application: lightcycle/application/**
  adapters: lightcycle/adapters/**
  entry: [lightcycle/container.py]
`);
    const result = check(scan, policy, null);

    expect(result.violations).toEqual([]);
    expect(result.unranked).toBe(0);
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
