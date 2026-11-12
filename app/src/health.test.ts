import type { FindingsDocument } from "recognizer";
import { describe, expect, it } from "vitest";
import {
  CURRENT,
  fixtureBaseline,
  fixturePolicy,
  fixtureScan,
  secondSensorDocument,
  structureDocument,
} from "./fixtures";
import {
  computeHealth,
  describeTree,
  type Health,
  violationLine,
} from "./health";
import { buildTree } from "./tree-model";

function healthFor(
  name: string,
  policy: string | null,
  findings: FindingsDocument[],
  baseline: string | null = null,
  modules?: string[],
) {
  const loaded = fixtureScan(name, "scan.json", CURRENT);
  const ids = modules ?? loaded.scan.modules.map((module) => module.id);

  return {
    health: computeHealth({
      scans: [loaded],
      policy,
      modules: ids,
      baseline,
      findings,
    }),
    ids,
  };
}

function healthOf(name: string, policy: string | null) {
  return healthFor(name, policy, [structureDocument(name, policy)]);
}

describe("computeHealth on fixtures/check", () => {
  const { health, ids } = healthOf("check", fixturePolicy("check"));

  it("marks violating modules red", () => {
    for (const id of [
      "shop/domain/order.py",
      "shop/domain/money.py",
      "shop/adapters/sql_store.py",
    ]) {
      expect(health.disc(id)).toBe("red");
    }
  });

  it("marks the cycle amber", () => {
    expect(health.disc("shop/application/place.py")).toBe("amber");
  });

  it("marks the other measured modules green", () => {
    for (const id of [
      "shop/ports/store.py",
      "shop/adapters/memory_store.py",
      "shop/main.py",
    ]) {
      expect(health.disc(id)).toBe("green");
    }
  });

  it("marks the module in an uncovered folder green, the folder being a policy problem and not a finding", () => {
    expect(health.disc("shop/legacy/helpers.py")).toBe("green");
  });

  it("shows an ignored module as a grey ring", () => {
    expect(health.disc("tests/test_order.py")).toBe("grey");
  });

  it("aggregates folders to the worst inside, grey above green", () => {
    const described = describeTree(buildTree(ids), health);

    expect(described.get("shop/domain")?.disc).toBe("red");
    expect(described.get("shop")?.disc).toBe("red");
    expect(described.get("shop/ports")?.disc).toBe("green");
    expect(described.get("tests")?.disc).toBe("grey");
  });

  it("reports no notices", () => {
    expect(health.notices).toEqual([]);
  });

  it("pins the finding line formats", () => {
    expect(health.lines("shop/domain/order.py")[0]).toMatch(
      /^violation: depends on shop\/adapters\/memory_store\.py at line \d+(, \d+)* \((level|uses|forbid) /,
    );
    expect(health.lines("shop/application/place.py")).toHaveLength(1);
    expect(health.lines("shop/application/place.py")[0]).toContain("cycle");
  });

  it("hovers say why, one line per finding", () => {
    const described = describeTree(buildTree(ids), health);

    expect(described.get("shop/main.py")?.hover).toBe("no findings");
    expect(described.get("tests/test_order.py")?.hover).toBe("not measured");
    expect(
      described.get("shop/domain/order.py")?.hover.split("\n").length,
    ).toBe(health.lines("shop/domain/order.py").length);
  });

  it("prefixes a folder hover with each module's path relative to the folder", () => {
    const described = describeTree(buildTree(ids), health);
    const lines = described.get("shop/domain")?.hover.split("\n") ?? [];

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((line) => /^(order|money)\.py: /.test(line))).toBe(true);
  });
});

describe("findings", () => {
  it("returns structured violations before warnings, leaving lines unchanged", () => {
    const { health } = healthOf("check", fixturePolicy("check"));
    const order = health.findings("shop/domain/order.py");

    expect(order.length).toBe(health.lines("shop/domain/order.py").length);
    expect(order[0]?.severity).toBe("violation");
    expect(order[0]?.text).toMatch(
      /^depends on shop\/adapters\/memory_store\.py at line \d+(, \d+)*$/,
    );
    expect(order[0]?.why).toMatch(/^(level|uses|forbid) /);
    expect(health.lines("shop/domain/order.py")[0]).toBe(
      `violation: ${order[0]?.text} (${order[0]?.why})`,
    );
  });

  it("returns a warning with its principle", () => {
    const { health } = healthOf("check", fixturePolicy("check"));
    const place = health.findings("shop/application/place.py");

    expect(place).toHaveLength(1);
    expect(place[0]?.severity).toBe("warning");
    expect(place[0]?.text).toContain("cycle");
    expect(place[0]?.why).toBe("no-cycles");
  });

  it("returns nothing for a green or a grey module", () => {
    const { health } = healthOf("check", fixturePolicy("check"));

    expect(health.findings("shop/main.py")).toEqual([]);
    expect(health.findings("tests/test_order.py")).toEqual([]);
  });

  it("covers the check-warnings fixture", () => {
    const { health } = healthOf(
      "check-warnings",
      fixturePolicy("check-warnings"),
    );

    expect(health.findings("app/domain/order.py")[0]?.severity).toBe(
      "violation",
    );
    expect(health.findings("app/domain/money.py")[0]?.severity).toBe("warning");
  });
});

describe("computeHealth on fixtures/check-warnings", () => {
  it("has one red, five amber and three green", () => {
    const { health, ids } = healthOf(
      "check-warnings",
      fixturePolicy("check-warnings"),
    );

    expect(health.disc("app/domain/order.py")).toBe("red");
    expect(health.disc("app/domain/money.py")).toBe("amber");

    for (const orphan of [
      "app/adapters/audit.py",
      "app/adapters/clock.py",
      "app/adapters/sql.py",
      "app/application/report.py",
    ]) {
      expect(health.disc(orphan)).toBe("amber");
    }

    const others = ids.filter((id) => health.disc(id) === "green");

    expect(others).toEqual([
      "app/ports/store.py",
      "app/application/place.py",
      "app/adapters/memory.py",
    ]);
  });
});

describe("computeHealth with a baseline", () => {
  const baseline = fixtureBaseline("check");

  function withBaseline(text: string | null) {
    return healthFor(
      "check",
      fixturePolicy("check"),
      [structureDocument("check", fixturePolicy("check"))],
      text,
    ).health;
  }

  it("does not mark a baselined violation red or list it as a finding", () => {
    const plain = withBaseline(null);
    const health = withBaseline(baseline);

    expect(plain.disc("shop/domain/order.py")).toBe("red");
    expect(health.findings("shop/domain/order.py").length).toBeLessThan(
      plain.findings("shop/domain/order.py").length,
    );
  });

  it("leaves a baselined violation and an out-of-date document's findings out of documents", () => {
    const policy = fixturePolicy("check");
    const plain = withBaseline(null);
    const health = withBaseline(baseline);
    const count = (documents: Health["documents"]) =>
      documents.reduce((total, one) => total + one.findings.length, 0);
    const stray = healthFor("check", policy, [
      structureDocument("check", policy),
      secondSensorDocument("shop/main.py", undefined, undefined, "other"),
    ]).health;

    expect(count(health.documents)).toBeLessThan(count(plain.documents));
    expect(
      stray.documents.find((one) => one.sensor.name === "lint")?.findings,
    ).toEqual([]);
    expect(stray.hidden.map((one) => one.sensor.name)).toEqual(["lint"]);
  });

  it("keeps a violation the baseline does not list", () => {
    const health = withBaseline(
      JSON.stringify({ schema_version: 1, violations: [] }),
    );

    expect(health.disc("shop/domain/order.py")).toBe("red");
  });

  it("notes an unreadable baseline and applies none", () => {
    const health = withBaseline("{");

    expect(health.notices).toHaveLength(1);
    expect(health.notices[0]).toMatch(/^baseline: /);
    expect(health.disc("shop/domain/order.py")).toBe("red");
  });
});

describe("computeHealth without a policy", () => {
  it("shows nothing red and both cycle modules amber", () => {
    const { health, ids } = healthOf("check", null);

    expect(ids.some((id) => health.disc(id) === "red")).toBe(false);
    expect(health.disc("shop/application/place.py")).toBe("amber");
    expect(health.disc("shop/domain/order.py")).toBe("amber");
    expect(health.disc("tests/test_order.py")).toBe("green");
  });

  it("drops a finding on an id that is not a module", () => {
    const modules = fixtureScan("check", "scan.json", CURRENT)
      .scan.modules.map((module) => module.id)
      .filter((id) => id !== "shop/domain/order.py");
    const { health } = healthFor(
      "check",
      fixturePolicy("check"),
      [structureDocument("check", fixturePolicy("check"))],
      null,
      modules,
    );

    expect(health.lines("shop/domain/order.py")).toEqual([]);
  });
});

describe("computeHealth from findings files", () => {
  it("measures nothing without a structure file, so every disc is grey", () => {
    const { health, ids } = healthFor("check", fixturePolicy("check"), []);

    expect(ids.every((id) => health.disc(id) === "grey")).toBe(true);
  });

  it("ignores a file from another commit, leaving its modules grey", () => {
    const { health, ids } = healthFor("check", fixturePolicy("check"), [
      structureDocument("check", fixturePolicy("check"), "old"),
    ]);

    expect(ids.every((id) => health.disc(id) === "grey")).toBe(true);
    expect(health.findings("shop/domain/order.py")).toEqual([]);
  });

  it("shows a finding from a second sensor with its summary and principle", () => {
    const { health } = healthFor("check", fixturePolicy("check"), [
      structureDocument("check", fixturePolicy("check")),
      secondSensorDocument("shop/main.py"),
    ]);

    expect(health.disc("shop/main.py")).toBe("amber");
    expect(health.findings("shop/main.py")).toEqual([
      {
        severity: "warning",
        text: "too many magic numbers",
        why: "name-your-constants",
      },
    ]);
  });

  it("marks a clean module green when a second sensor's current file covers it, without a structure file", () => {
    const { health } = healthFor("check", fixturePolicy("check"), [
      secondSensorDocument("shop/main.py"),
    ]);

    expect(health.disc("shop/main.py")).toBe("amber");
    expect(health.disc("shop/ports/store.py")).toBe("green");
  });

  it("keeps a module grey when the only current file is a stale second sensor", () => {
    const { health } = healthFor("check", fixturePolicy("check"), [
      secondSensorDocument("shop/main.py", "x", "y", "old"),
    ]);

    expect(health.disc("shop/ports/store.py")).toBe("grey");
  });

  it("ignores a stale second sensor", () => {
    const stale = secondSensorDocument("shop/main.py", "x", "y", "old");
    const { health } = healthFor("check", fixturePolicy("check"), [
      structureDocument("check", fixturePolicy("check")),
      stale,
    ]);

    expect(health.disc("shop/main.py")).toBe("green");
  });
});

describe("hover truncation", () => {
  it("ends with and <n> more after ten findings", () => {
    const ids = Array.from({ length: 12 }, (_, index) => `d/m${index}.py`);
    const health: Health = {
      documents: [],
      hidden: [],
      disc: () => "amber",
      lines: () => ["a finding"],
      findings: () => [],
      notices: [],
    };
    const hover = describeTree(buildTree(ids), health).get("d")?.hover ?? "";
    const lines = hover.split("\n");

    expect(lines).toHaveLength(11);
    expect(lines[10]).toBe("and 2 more");
  });
});

describe("violationLine", () => {
  const base = { from: "a", to: "b", lines: [3, 5] };

  it("names each rule kind", () => {
    expect(
      violationLine({
        ...base,
        kind: "depends",
        rules: [{ type: "level", from_level: "domain", to_level: "adapters" }],
      }),
    ).toBe("violation: depends on b at line 3, 5 (level domain -> adapters)");
    expect(
      violationLine({
        ...base,
        kind: "inherits",
        rules: [{ type: "uses", from_component: "x", to_component: "y" }],
      }),
    ).toBe("violation: inherits b at line 3, 5 (uses x -> y)");
    expect(
      violationLine({
        ...base,
        kind: "implements",
        rules: [{ type: "forbid", pattern: "* -> foreign:requests" }],
      }),
    ).toBe(
      "violation: implements b at line 3, 5 (forbid * -> foreign:requests)",
    );
  });
});

describe("computeHealth judged per module", () => {
  const H1 = "1".repeat(64);
  const H2 = "2".repeat(64);
  const H0 = "0".repeat(64);
  const T = "a".repeat(64);

  const scan = {
    file: "scan.python.json",
    scan: {
      modules: [
        { id: "a.py", kind: "module" },
        { id: "b.py", kind: "module" },
      ],
      edges: [],
      foreign: [],
      files: [
        { path: "a.py", hash: H1 },
        { path: "b.py", hash: H2 },
      ],
    },
  } as unknown as Parameters<typeof computeHealth>[0]["scans"][number];

  function crap(
    inputs: Record<string, string> | undefined,
    tests: string | undefined = T,
  ): FindingsDocument {
    const finding = (id: string, modules: string[]) => ({
      id,
      kind: "crap",
      severity: "warning" as const,
      principle: "reduce-risk",
      summary: id,
      evidence: { modules },
    });

    return {
      findings_version: 2,
      sensor: { name: "crap", version: "1" },
      commit: "whatever",
      modified: false,
      settings: {},
      findings: [
        finding("on-a", ["a.py"]),
        finding("on-b", ["b.py"]),
        finding("pair", ["a.py", "b.py"]),
      ],
      ...(inputs === undefined ? {} : { inputs }),
      ...(tests === undefined ? {} : { tests }),
    };
  }

  const healthOfDocument = (document: FindingsDocument, tests = T) =>
    computeHealth({
      scans: [scan],
      policy: null,
      modules: ["a.py", "b.py"],
      baseline: null,
      findings: [document],
      tests,
    });

  it("keeps the findings of current modules and hides the rest", () => {
    const health = healthOfDocument(crap({ "a.py": H1, "b.py": H0 }));

    expect(health.documents[0]?.findings.map((f) => f.id)).toEqual(["on-a"]);
    expect(health.hidden[0]?.findings.map((f) => f.id)).toEqual([
      "on-b",
      "pair",
    ]);
    expect(health.disc("a.py")).toBe("amber");
    expect(health.disc("b.py")).toBe("grey");
    expect(health.findings("b.py")).toEqual([]);
  });

  it("colours a module covered currently with no current findings green", () => {
    const health = healthOfDocument({
      ...crap({ "a.py": H1, "b.py": H2 }),
      findings: [],
    });

    expect(health.disc("a.py")).toBe("green");
    expect(health.disc("b.py")).toBe("green");
    expect(health.hidden).toEqual([]);
  });

  it("hides everything and leaves its modules grey without inputs", () => {
    const health = healthOfDocument(crap(undefined));

    expect(health.documents[0]?.findings).toEqual([]);
    expect(health.hidden[0]?.findings).toHaveLength(3);
    expect(health.disc("a.py")).toBe("grey");
    expect(health.disc("b.py")).toBe("grey");
  });

  it("hides every finding when the tests hash differs though modules match", () => {
    const health = healthOfDocument(
      crap({ "a.py": H1, "b.py": H2 }),
      "b".repeat(64),
    );

    expect(health.documents[0]?.findings).toEqual([]);
    expect(health.hidden[0]?.findings).toHaveLength(3);
    expect(health.disc("a.py")).toBe("grey");
  });
});
