import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { COMMANDS } from "../src/commands.js";
import {
  moduleCounts,
  moduleNames,
  neighbourSets,
  validateScan,
} from "../src/index.js";
import { REPO } from "./helpers.js";
import { type FakeOptions, fakeIo, ROOT } from "./scan-helpers.js";

const COMMIT = "abc123";
const CACHE = `${ROOT}/.recognizer/cache/scan.python.json`;

function read(path: string) {
  return readFileSync(join(REPO, path), "utf8");
}

const python = JSON.parse(read("fixtures/python/expected-scan.json"));
const warnings = JSON.parse(read("fixtures/check-warnings/scan.json"));

function repository(
  scan: Record<string, unknown>,
  extra: Record<string, string> = {},
  options: FakeOptions = {},
) {
  return fakeIo({
    commit: COMMIT,
    files: {
      [`${ROOT}/a.py`]: "",
      [CACHE]: JSON.stringify({
        ...scan,
        commit: COMMIT,
        modified: false,
        files: [],
      }),
      ...extra,
    },
    ...options,
  });
}

function ask(
  scan: Record<string, unknown>,
  argv: string[],
  extra: Record<string, string> = {},
) {
  const fake = repository(scan, extra);
  const code = run([...argv, "--repository", ROOT], fake.io);

  return { code, out: fake.out(), err: fake.err(), fake };
}

const warningsPolicy = {
  [`${ROOT}/.recognizer/policy.yaml`]: read(
    "fixtures/check-warnings/.recognizer/policy.yaml",
  ),
};

describe("find", () => {
  it("matches order by module path and by member name, in json", () => {
    const { code, out } = ask(python, ["find", "order", "--json"]);
    const document = JSON.parse(out);

    expect(code).toBe(0);
    expect(document.text).toBe("order");
    expect(document.modules.map((m: { id: string }) => m.id)).toEqual([
      "shop/domain/order.py",
    ]);
    expect(
      document.members.map(
        (m: { module: string; name: string }) => `${m.module}::${m.name}`,
      ),
    ).toEqual([
      "shop/domain/order.py::Order",
      "shop/domain/order.py::new_order",
    ]);
    expect(document.members[0]).toEqual({
      module: "shop/domain/order.py",
      name: "Order",
      kind: "class",
      line: 9,
      exported: true,
    });
  });

  it("prints both sections in text", () => {
    const { out } = ask(python, ["find", "order"]);

    expect(out.split("\n")[0]).toBe("1 module, 2 members matched");
    expect(out).toContain("modules\n  shop/domain/order.py\n");
    expect(out).toContain("  shop/domain/order.py::Order  class  line 9");
  });

  it("prints only the modules section for a path-only match", () => {
    const { out } = ask(python, ["find", "adapters"]);

    expect(out).toContain("modules\n");
    expect(out).not.toContain("members\n");
  });

  it("prints only the members section for a name-only match", () => {
    const { out } = ask(python, ["find", "new_order"]);

    expect(out).toContain("members\n");
    expect(out).not.toContain("modules\n");
  });

  it("is case-insensitive", () => {
    const { out } = ask(python, ["find", "ORDER", "--json"]);

    expect(JSON.parse(out).members).toHaveLength(2);
  });

  it("exits 0 with empty lists when nothing matches", () => {
    const { code, out } = ask(python, ["find", "zzzz", "--json"]);

    expect(code).toBe(0);
    expect(JSON.parse(out)).toEqual({ text: "zzzz", modules: [], members: [] });
  });

  it("exits 2 without the text", () => {
    expect(ask(python, ["find"]).code).toBe(2);
  });
});

describe("show", () => {
  const order = "shop/domain/order.py";

  it("lists only exported members and counts the rest as hidden", () => {
    const { code, out } = ask(python, ["show", order, "--json"]);
    const document = JSON.parse(out);

    expect(code).toBe(0);
    expect(document.module).toBe(order);
    expect(document.usedBy).toBe(4);
    expect(document.members.map((m: { name: string }) => m.name)).toEqual([
      "Order",
    ]);
    expect(document.hiddenPrivate).toBe(6);
    expect(document.members[0].visibility).toBe("public");
    expect(document.members[0].fields).toEqual([
      { signature: "id: str", line: 10, private: false },
      { signature: "items: int", line: 11, private: false },
    ]);
    expect(document.members[0].methods).toEqual([
      { signature: "total() → int", line: 14, private: false },
    ]);
  });

  it("lists every member with --private", () => {
    const { out } = ask(python, ["show", order, "--private", "--json"]);
    const document = JSON.parse(out);
    const names = document.members.map((m: { name: string }) => m.name);

    expect(names).toEqual([
      "MAX_ITEMS",
      "Order",
      "new_order",
      "_build",
      "_private",
    ]);
    expect(document.hiddenPrivate).toBe(0);
    expect(document.members[1].fields).toHaveLength(3);
    expect(document.members[1].methods).toHaveLength(2);
  });

  it("writes signatures for a function, a constant and a class", () => {
    const { out } = ask(python, ["show", order, "--private", "--json"]);
    const signatures = Object.fromEntries(
      JSON.parse(out).members.map((m: { name: string; signature: string }) => [
        m.name,
        m.signature,
      ]),
    );

    expect(signatures.new_order).toBe("new_order(order_id) → Order");
    expect(signatures._build).toBe("_build(order_id: str) → Order");
    expect(signatures.MAX_ITEMS).toBe("MAX_ITEMS = 100");
    expect(signatures.Order).toBe("Order");
  });

  it("writes a property as name: type and tags after a method", () => {
    const scan = structuredClone(python);
    const module = scan.modules.find((m: { id: string }) => m.id === order);

    module.members.push({
      name: "Shape",
      kind: "class",
      line: 40,
      exported: true,
      bases: ["Base"],
      methods: [
        {
          name: "area",
          line: 41,
          params: [],
          private: false,
          returns: "float",
          tags: ["property"],
        },
        {
          name: "make",
          line: 44,
          private: false,
          params: [{ name: "n", type: "int" }],
          tags: ["static", "async"],
        },
      ],
    });

    const document = JSON.parse(ask(scan, ["show", order, "--json"]).out);
    const shape = document.members.find(
      (m: { name: string }) => m.name === "Shape",
    );

    expect(shape.signature).toBe("Shape(Base)");
    expect(
      shape.methods.map((m: { signature: string }) => m.signature),
    ).toEqual(["area: float", "make(n: int) static async"]);
  });

  it("prints a header, members with nested fields and the hidden count in text", () => {
    const { out } = ask(python, ["show", order]);
    const lines = out.split("\n");

    expect(lines[0]).toBe(`${order}  module  uses 0  used by 4`);
    expect(lines[1]).toBe("responsibility: [missing]");
    expect(lines[2]).toBe("9  public  class  Order");
    expect(lines[3]).toBe("    10  public  field  id: str");
    expect(out).toContain("    14  public  method  total() → int");
    expect(out).toContain("6 private hidden");
    expect(out).toContain("no findings");
  });

  it("reports the hub and cycle warnings on the check-warnings fixture", () => {
    const hub = JSON.parse(
      ask(
        warnings,
        ["show", "app/application/place.py", "--hub-threshold", "3", "--json"],
        warningsPolicy,
      ).out,
    );
    const cycle = JSON.parse(
      ask(warnings, ["show", "app/domain/money.py", "--json"], warningsPolicy)
        .out,
    );

    expect(hub.findings.map((f: { why: string }) => f.why)).toContain(
      "interfaces-are-narrow-and-explicit",
    );
    expect(cycle.findings.map((f: { why: string }) => f.why)).toContain(
      "no-cycles",
    );
    expect(cycle.findings[0]).toEqual(
      expect.objectContaining({ severity: expect.any(String) }),
    );
  });

  it("exits 2 for an unknown module", () => {
    const { code, err } = ask(python, ["show", "nope.py"]);

    expect(code).toBe(2);
    expect(err).toContain("no such module: nope.py");
  });

  describe("responsibility", () => {
    const describer =
      "describer:\n  command: [describe-it, '{module}']\n  version: '1'\n";
    const source = "print('hi')\n";
    const hash = (text: string) =>
      createHash("sha256").update(text, "utf8").digest("hex");
    const entry = (sourceText: string) =>
      JSON.stringify({
        schema_version: 1,
        modules: {
          [order]: {
            line: "Holds an order.",
            source_hash: hash(sourceText),
            describer: ["describe-it", "{module}"],
            version: "1",
          },
        },
      });
    const status = (extra: Record<string, string>) =>
      JSON.parse(ask(python, ["show", order, "--json"], extra).out)
        .responsibility;

    it("is current when the line matches the source and the describer", () => {
      expect(
        status({
          [`${ROOT}/.recognizer/config.yaml`]: describer,
          [`${ROOT}/.recognizer/responsibilities.json`]: entry(source),
          [`${ROOT}/${order}`]: source,
        }),
      ).toEqual({ status: "current", line: "Holds an order." });
    });

    it("is out of date after the source changes", () => {
      expect(
        status({
          [`${ROOT}/.recognizer/config.yaml`]: describer,
          [`${ROOT}/.recognizer/responsibilities.json`]: entry(source),
          [`${ROOT}/${order}`]: "changed\n",
        }),
      ).toEqual({ status: "out-of-date", line: "Holds an order." });
    });

    it("is unchecked with an entry and no describer", () => {
      expect(
        status({
          [`${ROOT}/.recognizer/responsibilities.json`]: entry(source),
          [`${ROOT}/${order}`]: source,
        }),
      ).toEqual({ status: "unchecked", line: "Holds an order." });
    });

    it("is missing with no entry", () => {
      expect(status({})).toEqual({ status: "missing", line: null });
    });
  });
});

describe("modules", () => {
  const sets = neighbourSets(
    python.edges,
    new Set(moduleNames([validateScan(python)])),
  );
  const rows = (argv: string[], scan = python, extra = {}) =>
    JSON.parse(ask(scan, ["modules", ...argv, "--json"], extra).out);

  it("lists every module with total and count", () => {
    const document = rows([]);

    expect(document.total).toBe(14);
    expect(document.count).toBe(14);
    expect(document.modules.map((m: { id: string }) => m.id)).toEqual(
      [...document.modules.map((m: { id: string }) => m.id)].sort(),
    );
  });

  it("agrees with moduleCounts", () => {
    for (const row of rows([]).modules) {
      expect({ uses: row.uses, usedBy: row.usedBy }).toEqual({
        uses: moduleCounts(sets, row.id).uses,
        usedBy: moduleCounts(sets, row.id).usedBy,
      });
    }
  });

  it("filters by folder", () => {
    const ids = rows(["--folder", "shop/domain"]).modules.map(
      (m: { id: string }) => m.id,
    );

    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id: string) => id.startsWith("shop/domain/"))).toBe(true);
  });

  it("filters by used-by and uses minimums from the counts", () => {
    const expectedUsedBy = moduleNames([validateScan(python)])
      .filter((id) => moduleCounts(sets, id).usedBy >= 4)
      .sort();
    const expectedUses = moduleNames([validateScan(python)])
      .filter((id) => moduleCounts(sets, id).uses >= 2)
      .sort();

    expect(
      rows(["--min-used-by", "4"]).modules.map((m: { id: string }) => m.id),
    ).toEqual(expectedUsedBy);
    expect(expectedUsedBy).toContain("shop/domain/order.py");
    expect(
      rows(["--min-uses", "2"]).modules.map((m: { id: string }) => m.id),
    ).toEqual(expectedUses);
  });

  it("keeps total when a folder and a threshold match nothing", () => {
    const document = rows(["--folder", "shop/domain", "--min-uses", "99"]);

    expect(document.count).toBe(0);
    expect(document.total).toBe(14);
    expect(document.modules).toEqual([]);
  });

  it("keeps only modules with findings for --findings", () => {
    const document = rows(
      ["--findings", "--hub-threshold", "3"],
      warnings,
      warningsPolicy,
    );
    const ids = document.modules.map((m: { id: string }) => m.id);

    expect(ids).toContain("app/domain/money.py");
    expect(ids).toContain("app/application/place.py");
    expect(
      document.modules.every((m: { findings: number }) => m.findings > 0),
    ).toBe(true);
    expect(document.total).toBe(9);
  });

  it("sorts descending by each key with ties by id", () => {
    for (const [flag, key] of [
      ["uses", "uses"],
      ["used-by", "usedBy"],
    ] as const) {
      const sorted = rows(["--sort", flag]).modules;

      for (let i = 1; i < sorted.length; i += 1) {
        const [a, b] = [sorted[i - 1], sorted[i]];

        expect(a[key] > b[key] || (a[key] === b[key] && a.id < b.id)).toBe(
          true,
        );
      }
    }

    const byFindings = rows(
      ["--sort", "findings"],
      warnings,
      warningsPolicy,
    ).modules;

    expect(byFindings[0].findings).toBeGreaterThanOrEqual(
      byFindings[byFindings.length - 1].findings,
    );
    expect(byFindings[0].findings).toBeGreaterThan(0);
  });

  it("sorts by id ascending and flips with --reverse", () => {
    const forward = rows(["--sort", "id"]).modules.map(
      (m: { id: string }) => m.id,
    );
    const reversed = rows(["--reverse"]).modules.map(
      (m: { id: string }) => m.id,
    );

    expect(reversed).toEqual([...forward].reverse());
  });

  it("limits after sorting", () => {
    const document = rows(["--sort", "used-by", "--limit", "2"]);

    expect(document.count).toBe(2);
    expect(document.total).toBe(14);
    expect(document.modules[0].id).toBe("shop/domain/customer.py");
  });

  it("prints a count line and one row per module in text", () => {
    const { out } = ask(python, ["modules", "--limit", "2"]);
    const lines = out.trimEnd().split("\n");

    expect(lines[0]).toBe("2 of 14 modules");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(
      /^\S+ {2}\w+ {2}uses \d+ {2}used by \d+ {2}findings \d+$/,
    );
  });

  it.each([
    [["--limit", "0"]],
    [["--limit", "x"]],
    [["--sort", "name"]],
    [["--min-uses", "-1"]],
    [["extra"]],
  ])("exits 2 for %j", (argv) => {
    expect(ask(python, ["modules", ...argv]).code).toBe(2);
  });
});

describe("json on a triggered scan", () => {
  it("keeps stdout parseable when a scan ran first", () => {
    const fake = fakeIo({
      commit: COMMIT,
      files: {
        [`${ROOT}/a.py`]: "",
        [CACHE]: JSON.stringify({ ...python, commit: "old", files: [] }),
      },
      scanners: {
        "recognizer-scan-python": {
          output: JSON.stringify({ ...python, commit: COMMIT, files: [] }),
        },
      },
    });
    const code = run(["modules", "--json", "--repository", ROOT], fake.io);

    expect(code).toBe(0);
    expect(JSON.parse(fake.out()).total).toBe(14);
    expect(fake.err()).not.toBe("");
  });
});

describe("table examples", () => {
  it.each(["find", "show", "modules", "check"])(
    "the %s example runs against the python sample and exits 0",
    (name) => {
      const example = COMMANDS.find((command) => command.name === name)
        ?.examples[0]?.command as string;
      const argv = example
        .split(" ")
        .slice(1)
        .map((word) => (word === "fixtures/python/sample" ? ROOT : word));
      const fake = repository(python);

      expect(run(argv, fake.io)).toBe(0);
    },
  );
});
