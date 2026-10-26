import { describe, expect, it } from "vitest";
import { fixturePolicy, fixtureScan } from "./fixtures";
import {
  computeHealth,
  describeTree,
  type Health,
  violationLine,
} from "./health";
import { buildTree } from "./tree-model";

function healthOf(name: string, policy: string | null) {
  const loaded = fixtureScan(name);
  const ids = loaded.scan.modules.map((module) => module.id);

  return { health: computeHealth([loaded], policy, ids), ids };
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
      "shop/legacy/helpers.py",
    ]) {
      expect(health.disc(id)).toBe("green");
    }
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
  it("has one red, one amber and seven green", () => {
    const { health, ids } = healthOf(
      "check-warnings",
      fixturePolicy("check-warnings"),
    );

    expect(health.disc("app/domain/order.py")).toBe("red");
    expect(health.disc("app/domain/money.py")).toBe("amber");

    const others = ids.filter(
      (id) => id !== "app/domain/order.py" && id !== "app/domain/money.py",
    );

    expect(others).toHaveLength(7);
    expect(others.every((id) => health.disc(id) === "green")).toBe(true);
  });
});

describe("computeHealth without or with a bad policy", () => {
  it("shows nothing red without a policy and both cycle modules amber", () => {
    const { health, ids } = healthOf("check", null);

    expect(ids.some((id) => health.disc(id) === "red")).toBe(false);
    expect(health.disc("shop/application/place.py")).toBe("amber");
    expect(health.disc("shop/domain/order.py")).toBe("amber");
    expect(health.disc("tests/test_order.py")).toBe("green");
  });

  it("falls back to the no-policy result with a notice for an invalid policy", () => {
    const { health, ids } = healthOf("check", "levels: [");

    expect(health.notices).toHaveLength(1);
    expect(health.notices[0]).toMatch(/^policy\.yaml: /);
    expect(ids.some((id) => health.disc(id) === "red")).toBe(false);
    expect(health.disc("shop/domain/order.py")).toBe("amber");
  });

  it("falls back with a notice when a module matches two components", () => {
    const { health, ids } = healthOf(
      "check",
      "components:\n  one: shop/**\n  two: shop/domain/**\nlevels: [one, two]\n",
    );

    expect(health.notices).toHaveLength(1);
    expect(ids.some((id) => health.disc(id) === "red")).toBe(false);
  });

  it("drops a finding on an id that is not a module", () => {
    const loaded = fixtureScan("check");
    const modules = loaded.scan.modules
      .map((module) => module.id)
      .filter((id) => id !== "shop/domain/order.py");
    const health = computeHealth([loaded], fixturePolicy("check"), modules);

    expect(health.lines("shop/domain/order.py")).toEqual([]);
  });
});

describe("hover truncation", () => {
  it("ends with and <n> more after ten findings", () => {
    const ids = Array.from({ length: 12 }, (_, index) => `d/m${index}.py`);
    const health: Health = {
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
