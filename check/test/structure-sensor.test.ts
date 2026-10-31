import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  entryId,
  parseBaseline,
  serialiseBaseline,
  violationId,
} from "../src/baseline.js";
import { rankAgainstBaseline } from "../src/check.js";
import { validateFindings } from "../src/findings-document.js";
import { parsePolicy, validateScan } from "../src/index.js";
import {
  DEFAULT_STRUCTURE_SETTINGS,
  measuredModules,
  structureSensor,
} from "../src/structure-sensor.js";
import { REPO } from "./helpers.js";

const EXAMPLES = join(REPO, "schema/findings-examples");
const CONTEXT = { commit: "abc", modified: false };

function fixture(name: string) {
  const dir = join(REPO, "fixtures", name);
  const read = (path: string) => readFileSync(join(dir, path), "utf8");

  return {
    scan: validateScan(JSON.parse(read("scan.json"))),
    policy: parsePolicy(read(".recognizer/policy.yaml")),
    baselineText: read(".recognizer/baselines/violations.json"),
    expected: (file: string) => JSON.parse(read(file)),
  };
}

function sense(name: string, hub = 10, cycle = true, hubOn = true) {
  const { scan, policy } = fixture(name);

  return structureSensor(
    [scan],
    policy,
    { hub_threshold: hub, warnings: { cycle, hub: hubOn } },
    CONTEXT,
  );
}

describe("findings schema examples", () => {
  it.each(readdirSync(join(EXAMPLES, "valid")))("accepts %s", (file) => {
    const value = JSON.parse(
      readFileSync(join(EXAMPLES, "valid", file), "utf8"),
    );

    expect(() => validateFindings(value)).not.toThrow();
  });

  it.each(readdirSync(join(EXAMPLES, "invalid")))("rejects %s", (file) => {
    const value = JSON.parse(
      readFileSync(join(EXAMPLES, "invalid", file), "utf8"),
    );

    expect(() => validateFindings(value)).toThrow();
  });

  it("rejects a document from another sensor or commit when told what to expect", () => {
    const value = JSON.parse(
      readFileSync(join(EXAMPLES, "valid/empty.json"), "utf8"),
    );

    expect(() => validateFindings(value, { name: "other" })).toThrow(/sensor/);
    expect(() => validateFindings(value, { commit: "zzz" })).toThrow(/commit/);
  });
});

describe("structureSensor ids", () => {
  it("gives the same ids for the same evidence on every run", () => {
    const first = sense("check-warnings", 3).document.findings.map((f) => f.id);
    const second = sense("check-warnings", 3).document.findings.map(
      (f) => f.id,
    );

    expect(second).toEqual(first);
  });

  it("keeps a hub id when only the threshold changes", () => {
    const at3 = sense("check-warnings", 3).document.findings;
    const at2 = sense("check-warnings", 2).document.findings;
    const hub = (findings: typeof at3) =>
      findings.find((f) => f.kind === "hub")?.id;

    expect(hub(at3)).toBe("hub:app/application/place.py");
    expect(hub(at2)).toBe(hub(at3));
  });

  it("gives the same cycle ids when the scans are reordered", () => {
    const { scan, policy } = fixture("check-warnings");
    const other = { ...scan, modules: [...scan.modules].reverse() };
    const ids = (scans: (typeof scan)[]) =>
      structureSensor(scans, policy, DEFAULT_STRUCTURE_SETTINGS, CONTEXT)
        .document.findings.filter((f) => f.kind === "cycle")
        .map((f) => f.id);

    expect(ids([other])).toEqual(ids([scan]));
  });

  it("produces a document that validates against the schema", () => {
    expect(() =>
      validateFindings(sense("check").document, { name: "structure" }),
    ).not.toThrow();
  });

  it("leaves a switched-off warning out and still reports metrics", () => {
    const off = sense("check-warnings", 3, false, false);

    expect(
      off.document.findings.filter((f) => f.severity === "warning"),
    ).toEqual([]);
    expect(off.metrics.length).toBeGreaterThan(0);
    expect(off.document.settings).toEqual({
      hub_threshold: 3,
      warnings: { cycle: false, hub: false },
    });
  });
});

describe("structureSensor over the committed fixtures", () => {
  it("finds the five violations fixtures/check lists, by id", () => {
    const expected = fixture("check").expected("expected.json");
    const found = sense("check").document.findings.filter(
      (f) => f.severity === "violation",
    );

    expect(found.map((f) => f.id)).toEqual(
      expected.violations.map(violationId),
    );
    expect(found).toHaveLength(5);
  });

  it("finds the violation, cycle and hub fixtures/check-warnings lists, by id", () => {
    const found = sense("check-warnings", 3).document.findings.map((f) => f.id);

    expect(found).toContain(
      "rule-violation:depends:app/domain/order.py->app/adapters/memory.py",
    );
    expect(found).toContain("cycle:app/domain/money.py,app/domain/order.py");
    expect(found).toContain("hub:app/application/place.py");
    expect(found.filter((id) => id.startsWith("rule-violation:"))).toHaveLength(
      1,
    );
  });
});

describe("baseline compatibility", () => {
  it("reads the committed fixtures/check baseline against the new ids", () => {
    const { baselineText } = fixture("check");
    const baseline = parseBaseline(baselineText);
    const document = sense("check").document;
    const violations = document.findings.filter(
      (f) => f.severity === "violation",
    );
    const matching = baseline.filter((entry) =>
      violations.some((f) => f.id === entryId(entry)),
    );
    const ranked = rankAgainstBaseline(
      violations.map((f) => {
        const edge = f.evidence.edges?.[0] as {
          from: string;
          to: string;
          kind: string;
        };

        return { ...edge, lines: [], rules: [] };
      }),
      0,
      baseline,
    );

    expect(baseline).toHaveLength(2);
    expect(matching.map(entryId)).toEqual([
      "rule-violation:depends:shop/domain/order.py->shop/adapters/memory_store.py",
    ]);
    expect(ranked.new).toHaveLength(4);
    expect(ranked.fixed).toEqual([
      {
        from: "shop/application/place.py",
        to: "shop/adapters/sql_store.py",
        kind: "depends",
      },
    ]);
  });

  it("reads the committed fixtures/check-warnings baseline against the new ids", () => {
    const { baselineText } = fixture("check-warnings");
    const baseline = parseBaseline(baselineText);
    const violations = sense("check-warnings", 3).document.findings.filter(
      (f) => f.severity === "violation",
    );

    expect(baseline).toHaveLength(1);
    expect(violations.map((f) => f.id)).toEqual(baseline.map(entryId));
  });

  it.each(["check", "check-warnings"])(
    "serialises the %s baseline byte for byte",
    (name) => {
      const { baselineText } = fixture(name);

      expect(serialiseBaseline(parseBaseline(baselineText))).toBe(baselineText);
    },
  );
});

describe("measuredModules", () => {
  it("lists the modules the sensor measures, leaving out an ignored one", () => {
    const { scan, policy } = fixture("check");
    const withPolicy = measuredModules([scan], policy);
    const without = measuredModules([scan], null);

    expect(withPolicy.has("shop/main.py")).toBe(true);
    expect(withPolicy.has("tests/test_order.py")).toBe(false);
    expect(without.has("tests/test_order.py")).toBe(true);
  });

  it("equals the ids of the metrics the sensor reports", () => {
    const { scan, policy } = fixture("check");
    const { metrics } = structureSensor(
      [scan],
      policy,
      DEFAULT_STRUCTURE_SETTINGS,
      CONTEXT,
    );

    expect([...measuredModules([scan], policy)].sort()).toEqual(
      metrics.map((metric) => metric.id).sort(),
    );
  });
});
