import { describe, expect, it } from "vitest";
import {
  buildOverlayModel,
  DESCRIPTIONS,
  footerText,
  type MetricDescriptor,
  moduleValue,
  pruneTicks,
} from "./overlay-model";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";

type Declared = {
  name: string;
  type?: string;
  granularity?: string;
  bad?: string;
};

function overlay(
  metrics: Declared[],
  values: Record<string, Record<string, number | boolean>>,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    overlay_version: 1,
    commit: COMMIT,
    modified: false,
    producer: { name: "crap", version: "0.1.0" },
    metrics: metrics.map((metric) => ({
      type: "count",
      granularity: "member",
      bad: "high",
      ...metric,
    })),
    values,
    ...extra,
  });
}

function only(text: string, scan: string | null = COMMIT): MetricDescriptor {
  const model = buildOverlayModel([{ name: "crap", text }], { commit: scan });

  return model.metrics[0] as MetricDescriptor;
}

describe("freshness and headings", () => {
  const text = overlay([{ name: "complexity" }], {});

  it("is fresh when the commit equals the scan's", () => {
    const model = buildOverlayModel([{ name: "crap", text }], {
      commit: COMMIT,
    });

    expect(model.groups[0]?.stale).toBe(false);
    expect(model.groups[0]?.heading).toBe("crap - crap 0.1.0 - at 0123456");
  });

  it("appends the modified tree", () => {
    const modified = overlay([{ name: "complexity" }], {}, { modified: true });
    const model = buildOverlayModel([{ name: "crap", text: modified }], {
      commit: COMMIT,
    });

    expect(model.groups[0]?.heading).toBe(
      "crap - crap 0.1.0 - at 0123456, modified tree",
    );
  });

  it("is stale for a different commit and for a scan with none", () => {
    for (const scan of ["ffffffffffff", null]) {
      const model = buildOverlayModel([{ name: "crap", text }], {
        commit: scan,
      });

      expect(model.groups[0]?.stale).toBe(true);
      expect(model.groups[0]?.heading).toBe(
        "crap - crap 0.1.0 - from 0123456, not the scan's",
      );
      expect(model.metrics[0]?.stale).toBe(true);
    }
  });
});

describe("descriptors", () => {
  it("keys by overlay and metric, takes max across member entries and describes the five names", () => {
    const metric = only(
      overlay([{ name: "complexity" }], {
        complexity: { "a.py::f": 8, "b.ts::g": 1 },
      }),
    );

    expect(metric.key).toBe("crap/complexity");
    expect(metric.max).toBe(8);
    expect(metric.description).toBe(DESCRIPTIONS.complexity);

    for (const name of [
      "complexity",
      "coverage",
      "line_coverage",
      "crap",
      "mutation_survived",
    ]) {
      expect(DESCRIPTIONS[name]).toBeTruthy();
    }

    expect(only(overlay([{ name: "other" }], {})).description).toBeUndefined();
    expect(only(overlay([{ name: "complexity" }], {})).max).toBe(0);
  });

  it("lists a file that fails validation as unreadable and keeps the others", () => {
    const model = buildOverlayModel(
      [
        {
          name: "bad",
          text: overlay([{ name: "coverage", type: "ratio" }], {
            coverage: { "a.py::f": 1.5 },
          }),
        },
        {
          name: "negative",
          text: overlay([{ name: "complexity" }], {
            complexity: { "a.py::f": -1 },
          }),
        },
        { name: "garbage", text: "not json" },
        { name: "good", text: overlay([{ name: "complexity" }], {}) },
      ],
      { commit: COMMIT },
    );

    expect(model.unreadable).toEqual(["bad", "garbage", "negative"]);
    expect(model.groups.map((group) => group.name)).toEqual(["good"]);
  });
});

describe("per-module values", () => {
  it("takes the max for bad high and the min for bad low, ties to the lowest id", () => {
    const high = only(
      overlay([{ name: "complexity" }], {
        complexity: { "a.py::b": 5, "a.py::a": 5, "a.py::c": 2 },
      }),
    );
    const low = only(
      overlay([{ name: "coverage", type: "ratio", bad: "low" }], {
        coverage: { "a.py::z": 0.5, "a.py::y": 0.2, "a.py::x": 0.2 },
      }),
    );

    expect(moduleValue(high, "a.py")).toEqual({ value: 5, member: "a" });
    expect(moduleValue(low, "a.py")).toEqual({ value: 0.2, member: "x" });
  });

  it("reads a module-granularity metric directly", () => {
    const metric = only(
      overlay(
        [
          {
            name: "line_coverage",
            type: "ratio",
            granularity: "module",
            bad: "low",
          },
        ],
        {
          line_coverage: { "a.py": 0.4 },
        },
      ),
    );

    expect(moduleValue(metric, "a.py")).toEqual({ value: 0.4, member: null });
    expect(moduleValue(metric, "b.py")).toBeNull();
  });

  it("splits on the first :: only", () => {
    const metric = only(
      overlay([{ name: "complexity" }], {
        complexity: { "a.py::Foo.bar": 3, "a.py::Foo::baz": 2 },
      }),
    );

    expect(moduleValue(metric, "a.py")).toEqual({
      value: 3,
      member: "Foo.bar",
    });
  });

  it("does not match a module whose id merely starts with another's", () => {
    const metric = only(
      overlay([{ name: "complexity" }], { complexity: { "ab.py::f": 3 } }),
    );

    expect(moduleValue(metric, "a")).toBeNull();
  });

  it("ranks true above false for a boolean", () => {
    const metric = only(
      overlay([{ name: "flag", type: "boolean" }], {
        flag: { "a.py::f": false, "a.py::g": true },
      }),
    );

    expect(moduleValue(metric, "a.py")).toEqual({ value: true, member: "g" });
  });

  it("leaves unknown modules null rather than zero-filling or dropping them", () => {
    const metric = only(
      overlay([{ name: "complexity" }], {
        complexity: { "one.py::f": 4, "two.py::g": 1, "two.py::h": 6 },
      }),
    );
    const results = ["one.py", "two.py", "three.py"].map((id) =>
      moduleValue(metric, id),
    );

    expect(results).toEqual([
      { value: 4, member: "f" },
      { value: 6, member: "h" },
      null,
    ]);
    expect(results.filter((result) => result === null)).toHaveLength(1);
  });
});

describe("pruneTicks", () => {
  it("drops stale and removed ticks and keeps the order of the rest", () => {
    const fresh = buildOverlayModel(
      [
        {
          name: "a",
          text: overlay([{ name: "m1" }, { name: "m2" }], {}),
        },
      ],
      { commit: COMMIT },
    );
    const stale = buildOverlayModel(
      [{ name: "a", text: overlay([{ name: "m1" }, { name: "m2" }], {}) }],
      { commit: "other" },
    );

    expect(pruneTicks(["a/m2", "gone/x", "a/m1"], fresh.metrics)).toEqual([
      "a/m2",
      "a/m1",
    ]);
    expect(pruneTicks(["a/m2", "a/m1"], stale.metrics)).toEqual([]);
  });
});

describe("footerText", () => {
  const model = buildOverlayModel(
    [
      {
        name: "crap",
        text: overlay([{ name: "complexity" }, { name: "coverage" }], {}),
      },
    ],
    { commit: COMMIT },
  );

  it("names labels in tick order and the overlay once", () => {
    expect(footerText(model.metrics)).toBe(
      "Showing complexity, coverage from crap",
    );
  });

  it("is null when nothing is ticked", () => {
    expect(footerText([])).toBeNull();
  });
});
