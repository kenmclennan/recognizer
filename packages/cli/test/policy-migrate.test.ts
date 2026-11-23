import { readFileSync } from "node:fs";
import { join } from "node:path";
import { orphanFindings, PolicyRule } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { run } from "../src/cli.js";
import { check, parsePolicy } from "../src/index.js";
import { migratePolicy } from "../src/policy-migrate.js";
import { REPO } from "./helpers.js";
import { repositoryFrom } from "./repository-from.js";
import { fakeIo, ROOT } from "./scan-helpers.js";
import { documentOf } from "./scan-of.js";

const LOOM = `components:
  application: [engine/src/application/**]
  adapters: [engine/src/adapters/**]
levels: [application, adapters]
`;

const LIGHTCYCLE = `components:
  domain: [lightcycle/domain/**, lightcycle/ports/**]
  application: [lightcycle/application/**, lightcycle/config.py, lightcycle/extra/**]
  adapters: [lightcycle/adapters/**, lightcycle/db.py]
  entry: [lightcycle/container.py, lightcycle/cli.py, lightcycle/worker_main.py, lightcycle/__main__.py]
levels: [domain, application, adapters, entry]
`;

const SLICES = `components:
  shared: s/**
  orders: o/**
  billing: b/**
uses:
  orders: [shared]
  billing: [shared]
  shared: []
`;

interface Retired {
  components: Record<string, string | string[]>;
  levels?: string[];
  uses?: Record<string, string[]>;
}

function migrated(text: string): string {
  const outcome = migratePolicy(text);

  if (outcome.status !== "ok") {
    throw new Error(outcome.messages.join("; "));
  }

  return outcome.text;
}

function globMatches(glob: string, id: string): boolean {
  const policy = parsePolicy(`entry: ['${glob}']\n`);

  return PolicyRule.entries(policy).some((rule) => rule.marks(id));
}

function oldTriples(text: string, edges: [string, string][]): string[] {
  const retired = parse(text) as Retired;
  const names = Object.keys(retired.components);
  const componentOf = (id: string) =>
    names.find((name) =>
      [retired.components[name]]
        .flat()
        .some((glob) => globMatches(glob as string, id)),
    );
  const levels = retired.levels ?? [];
  const uses = retired.uses ?? null;
  const found: string[] = [];

  for (const [from, to] of edges) {
    const a = componentOf(from);
    const b = componentOf(to);

    if (a === undefined || b === undefined || a === b) {
      continue;
    }

    if (levels.length === 0 && uses === null) {
      continue;
    }

    const ranked = levels.includes(a) && levels.includes(b);

    if (ranked && levels.indexOf(a) >= levels.indexOf(b)) {
      continue;
    }

    if (uses?.[a]?.includes(b)) {
      continue;
    }

    found.push(`${from} -> ${to}`);
  }

  return found.sort();
}

function newTriples(policyText: string, edges: [string, string][]): string[] {
  const result = check(documentOf(edges), parsePolicy(policyText), null);

  return result.violations
    .flatMap((violation) =>
      violation.dependencies.map((one) => `${violation.file} -> ${one.to}`),
    )
    .sort();
}

function allPairs(ids: string[]): [string, string][] {
  return ids.flatMap((from) =>
    ids.filter((to) => to !== from).map((to): [string, string] => [from, to]),
  );
}

describe("recognizer policy --migrate", () => {
  it("loom policy becomes one list rule and no entry", () => {
    expect(migrated(LOOM)).toBe(
      "forbid:\n  - from: [engine/src/application/**]\n    to: [engine/src/adapters/**]\n",
    );
  });

  it("loom policy keeps the same import triples over every pair", () => {
    const edges = allPairs([
      "engine/src/application/a.ts",
      "engine/src/application/b.ts",
      "engine/src/adapters/c.ts",
      "engine/src/other/d.ts",
    ]);

    expect(oldTriples(LOOM, edges).length).toBeGreaterThan(0);
    expect(newTriples(migrated(LOOM), edges)).toEqual(oldTriples(LOOM, edges));
  });

  it("lightcycle policy yields three list rules and its literals in entry in component order", () => {
    const text = migrated(LIGHTCYCLE);
    const policy = parse(text) as {
      entry: string[];
      forbid: { from: string[]; to: string[] }[];
    };

    expect(policy.entry).toEqual([
      "lightcycle/config.py",
      "lightcycle/db.py",
      "lightcycle/container.py",
      "lightcycle/cli.py",
      "lightcycle/worker_main.py",
      "lightcycle/__main__.py",
    ]);
    expect(policy.forbid).toEqual([
      {
        from: ["lightcycle/domain/**", "lightcycle/ports/**"],
        to: [
          "lightcycle/application/**",
          "lightcycle/config.py",
          "lightcycle/extra/**",
          "lightcycle/adapters/**",
          "lightcycle/db.py",
          "lightcycle/container.py",
          "lightcycle/cli.py",
          "lightcycle/worker_main.py",
          "lightcycle/__main__.py",
        ],
      },
      {
        from: [
          "lightcycle/application/**",
          "lightcycle/config.py",
          "lightcycle/extra/**",
        ],
        to: [
          "lightcycle/adapters/**",
          "lightcycle/db.py",
          "lightcycle/container.py",
          "lightcycle/cli.py",
          "lightcycle/worker_main.py",
          "lightcycle/__main__.py",
        ],
      },
      {
        from: ["lightcycle/adapters/**", "lightcycle/db.py"],
        to: [
          "lightcycle/container.py",
          "lightcycle/cli.py",
          "lightcycle/worker_main.py",
          "lightcycle/__main__.py",
        ],
      },
    ]);
  });

  it("lightcycle policy keeps the same import triples over every pair", () => {
    const edges = allPairs([
      "lightcycle/domain/a.py",
      "lightcycle/ports/p.py",
      "lightcycle/application/s.py",
      "lightcycle/config.py",
      "lightcycle/adapters/x.py",
      "lightcycle/db.py",
      "lightcycle/container.py",
      "lightcycle/cli.py",
      "lightcycle/unlisted.py",
    ]);

    expect(newTriples(migrated(LIGHTCYCLE), edges)).toEqual(
      oldTriples(LIGHTCYCLE, edges),
    );
  });

  it("a uses-only policy forbids each component every other it does not use", () => {
    const policy = parse(migrated(SLICES)) as {
      forbid: { from: string[]; to: string[] }[];
    };

    expect(policy.forbid).toEqual([
      { from: ["s/**"], to: ["o/**", "b/**"] },
      { from: ["o/**"], to: ["b/**"] },
      { from: ["b/**"], to: ["o/**"] },
    ]);
  });

  it("a uses-only policy keeps the same import triples over every pair", () => {
    const edges = allPairs(["s/a.py", "o/b.py", "b/c.py", "z/d.py"]);

    expect(newTriples(migrated(SLICES), edges)).toEqual(
      oldTriples(SLICES, edges),
    );
  });

  it("a component outside levels is forbidden both directions unless uses lists it", () => {
    const text = `components:
  a: a/**
  b: b/**
  c: c/**
levels: [a, b]
uses:
  c: [a]
`;
    const policy = parse(migrated(text)) as {
      forbid: { from: string[]; to: string[] }[];
    };

    expect(policy.forbid).toEqual([
      { from: ["a/**"], to: ["b/**", "c/**"] },
      { from: ["b/**"], to: ["c/**"] },
      { from: ["c/**"], to: ["b/**"] },
    ]);

    const edges = allPairs(["a/1.py", "b/1.py", "c/1.py"]);

    expect(newTriples(migrated(text), edges)).toEqual(oldTriples(text, edges));
  });

  it("never writes a rule for a component importing itself, and writes the i to i+1 edge", () => {
    const text = "components:\n  a: a/**\n  b: b/**\nlevels: [a, b]\n";
    const policy = parse(migrated(text)) as {
      forbid: { from: string[]; to: string[] }[];
    };

    expect(policy.forbid).toEqual([{ from: ["a/**"], to: ["b/**"] }]);
    expect(newTriples(migrated(text), [["a/1.py", "a/2.py"]])).toEqual([]);
    expect(newTriples(migrated(text), [["a/1.py", "b/1.py"]])).toEqual([
      "a/1.py -> b/1.py",
    ]);
    expect(newTriples(migrated(text), [["b/1.py", "a/1.py"]])).toEqual([]);
  });

  it("migrating again changes nothing, and comments and ignore survive and foreign is removed", () => {
    const text = `# the rules
components:
  a: a/**
  b: [b/**, main.py] # b holds main
levels: [a, b]

foreign:
  stdlib: [os]

ignore: [tests/**] # skip tests
`;
    const once = migrated(text);

    expect(once).toContain("# the rules");
    expect(once).not.toContain("foreign");
    expect(once).toContain("ignore: [tests/**] # skip tests");
    expect(once).not.toMatch(/components|levels|uses/);
    expect(migrated(once)).toBe(once);
    expect(migratePolicy(once)).toMatchObject({ status: "ok", changes: [] });
    expect(() => parsePolicy(once)).not.toThrow();
  });

  it("a policy with no retired key is left byte for byte", () => {
    const text = "forbid:\n  - a/** -> b/**\n";

    expect(migratePolicy(text)).toEqual({ status: "ok", text, changes: [] });
  });

  it.each([
    [
      "a level naming no component",
      "components:\n  a: x/**\nlevels: [a, b]\n",
      'levels: "b" is not in components',
    ],
    [
      "a duplicate level",
      "components:\n  a: x/**\nlevels: [a, a]\n",
      'levels: duplicate level "a"',
    ],
    [
      "an empty levels list",
      "components:\n  a: x/**\nlevels: []\n",
      "levels: must be a non-empty list of component names",
    ],
    [
      "a uses key naming no component",
      "components:\n  a: x/**\nuses:\n  b: [a]\n",
      'uses: "b" is not in components',
    ],
    [
      "an empty glob",
      'components:\n  a: ""\n',
      "components.a: every glob must be a non-empty string",
    ],
  ])("%s exits 2 and changes nothing", (_name, text, message) => {
    const fake = fakeIo({
      files: { [`${ROOT}/.recognizer/policy.yaml`]: text },
    });
    const status = run(["policy", "--migrate", "--repository", ROOT], fake.io);

    expect(status).toBe(2);
    expect(fake.err()).toContain(message);
    expect(fake.files.get(`${ROOT}/.recognizer/policy.yaml`)).toBe(text);
  });

  it("a uses entry listing one declared and one undeclared component names the undeclared one and writes nothing", () => {
    const text = "components:\n  a: x/**\nuses:\n  a: [a, ghost]\n";
    const fake = fakeIo({
      files: { [`${ROOT}/.recognizer/policy.yaml`]: text },
    });

    expect(run(["policy", "--migrate", "--repository", ROOT], fake.io)).toBe(2);
    expect(fake.err()).toContain('"ghost" is not in components');
    expect(fake.files.get(`${ROOT}/.recognizer/policy.yaml`)).toBe(text);
  });

  it("prints one line per change and writes the migrated policy", () => {
    const fake = fakeIo({
      files: { [`${ROOT}/.recognizer/policy.yaml`]: LOOM },
    });

    expect(run(["policy", "--migrate", "--repository", ROOT], fake.io)).toBe(0);
    expect(fake.out().trim().split("\n")).toEqual([
      "removed components, levels",
      "forbid: engine/src/application/** -> engine/src/adapters/**",
    ]);
    expect(fake.files.get(`${ROOT}/.recognizer/policy.yaml`)).toBe(
      migrated(LOOM),
    );
  });
});

describe("committed fixtures keep their import triples", () => {
  const OLD_CHECK = `levels:
  - domain
  - ports
  - application
  - adapters
  - entry

components:
  domain: shop/domain/**
  ports: shop/ports/**
  application: shop/application/**
  adapters: shop/adapters/**
  entry: [shop/main.py]

forbid:
  - shop/adapters/* -> shop/adapters/*
  - "* -> foreign:requests"

ignore: [tests/**]
`;
  const OLD_USES = `components:
  shared: app/shared/**
  orders: app/orders/**
  billing: app/billing/**

uses:
  orders: [shared]
  billing: [shared]
  shared: []

forbid:
  - "* -> foreign:requests"
`;
  const OLD_WARNINGS = `components:
  domain: app/domain/**
  ports: app/ports/**
  application: app/application/**
  adapters: app/adapters/**

levels:
  - domain
  - ports
  - application
  - adapters
`;

  const triplesOf = (dir: string, policyText: string) => {
    const scan = JSON.parse(
      readFileSync(join(REPO, "fixtures", dir, "scan.json"), "utf8"),
    );
    const result = check(scan, parsePolicy(policyText), null);

    return result.violations
      .flatMap((violation) =>
        violation.dependencies.map(
          (one) => `${violation.file} -> ${one.to} ${one.kind}`,
        ),
      )
      .sort();
  };

  it.each([
    [
      "check",
      OLD_CHECK,
      [
        "shop/adapters/sql_store.py -> foreign:requests depends",
        "shop/adapters/sql_store.py -> shop/adapters/memory_store.py depends",
        "shop/domain/money.py -> shop/ports/store.py implements",
        "shop/domain/order.py -> shop/adapters/memory_store.py depends",
        "shop/domain/order.py -> shop/application/place.py depends",
      ],
    ],
    [
      "check-uses",
      OLD_USES,
      [
        "app/orders/place.py -> app/billing/invoice.py depends",
        "app/orders/place.py -> foreign:requests depends",
        "app/shared/money.py -> app/orders/place.py implements",
      ],
    ],
    [
      "check-warnings",
      OLD_WARNINGS,
      ["app/domain/order.py -> app/adapters/memory.py depends"],
    ],
  ])("%s", (dir, oldText, expected) => {
    expect(expected.length).toBeGreaterThan(0);
    expect(triplesOf(dir, migrated(oldText))).toEqual(expected);
    expect(
      readFileSync(
        join(REPO, "fixtures", dir, ".recognizer/policy.yaml"),
        "utf8",
      ),
    ).toBe(migrated(oldText));
  });

  it("keeps the orphan warnings, and a literal path stays unflagged both as the old literal and as the migrated entry", () => {
    const document = JSON.parse(
      readFileSync(join(REPO, "fixtures/check/scan.json"), "utf8"),
    );
    const scan = repositoryFrom(document);
    const orphans = (policyText: string) =>
      orphanFindings(scan, parsePolicy(policyText), [], []).map(
        (finding) => finding.id,
      );
    const migratedCheck = migrated(OLD_CHECK);

    expect(orphans(migratedCheck)).toEqual([
      "orphan:shop/adapters/sql_store.py",
      "orphan:shop/domain/money.py",
    ]);
    expect(orphans(migratedCheck)).not.toContain("orphan:shop/main.py");

    const lonely = (policyText: string) =>
      orphanFindings(
        repositoryFrom({
          ...document,
          modules: [
            ...document.modules,
            {
              id: "shop/tool.py",
              language: "python",
              kind: "module",
              members: [],
            },
          ],
        }),
        parsePolicy(policyText),
        [],
        [],
      ).map((finding) => finding.id);

    const withTool = migrated(
      OLD_CHECK.replace(
        "entry: [shop/main.py]",
        "entry: [shop/main.py, shop/tool.py]",
      ),
    );

    expect(lonely(migratedCheck)).toContain("orphan:shop/tool.py");
    expect(lonely(withTool)).not.toContain("orphan:shop/tool.py");
    expect(parse(withTool).entry).toContain("shop/tool.py");
  });
});

describe("recognizer policy --migrate of foreign", () => {
  it("removes foreign alone, writes nothing in its place and leaves the other rules", () => {
    const text = `# rules
forbid:
  - a/** -> b/**

foreign:
  stdlib: [os]

ignore: [tests/**]
`;
    const outcome = migratePolicy(text);

    expect(outcome).toMatchObject({
      status: "ok",
      changes: ["removed foreign"],
    });
    expect(outcome.status === "ok" && outcome.text).toBe(`# rules
forbid:
  - a/** -> b/**

ignore: [tests/**]
`);
  });
});
