import { SHIPPED_SENSOR_LIST } from "recognizer";
import { describe, expect, it } from "vitest";
import {
  buildOverlayModel,
  currentMetricNamed,
  DESCRIPTIONS,
  footerText,
  groupHeader,
  type MetricDescriptor,
  moduleValue,
  pruneTicks,
  TITLES,
} from "./overlay-model";
import type { SensorStatus, ShippedSensors } from "./sensor-run";

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

describe("freshness and tooltips", () => {
  const text = overlay([{ name: "complexity" }], {});

  it("is fresh when the commit equals the scan's", () => {
    const model = buildOverlayModel([{ name: "crap", text }], {
      commit: COMMIT,
    });

    expect(model.groups[0]?.stale).toBe(false);
    expect(model.groups[0]?.tooltip).toBe("crap 0.1.0 - at 0123456");
  });

  it("appends the modified tree", () => {
    const modified = overlay([{ name: "complexity" }], {}, { modified: true });
    const model = buildOverlayModel([{ name: "crap", text: modified }], {
      commit: COMMIT,
    });

    expect(model.groups[0]?.tooltip).toBe(
      "crap 0.1.0 - at 0123456, modified tree",
    );
  });

  it("is stale for a different commit and for a scan with none", () => {
    for (const scan of ["ffffffffffff", null]) {
      const model = buildOverlayModel([{ name: "crap", text }], {
        commit: scan,
      });

      expect(model.groups[0]?.stale).toBe(true);
      expect(model.groups[0]?.tooltip).toBe(
        "crap 0.1.0 - from 0123456, not the scan's",
      );
      expect(model.metrics[0]?.stale).toBe(true);
    }
  });
});

const SHIPPED: ShippedSensors = {
  status: "ok",
  sensors: SHIPPED_SENSOR_LIST.filter(
    (sensor) => sensor.metrics.length > 0,
  ).map((sensor) => ({
    name: sensor.name,
    display: sensor.display,
    line: sensor.line,
    defaults: {},
    runsTests: sensor.runs_tests,
    listed: sensor.listed,
    metrics: [...sensor.metrics],
  })),
};

function ran(name: string, over: Partial<SensorStatus> = {}): SensorStatus {
  return { name, status: "ran", commit: COMMIT, findings: 0, ...over };
}

function groupOf(
  name: string,
  statuses: SensorStatus[],
  scan: string | null = COMMIT,
  modifiedMs: number | null = 1000,
) {
  const model = buildOverlayModel(
    [
      {
        name,
        text: overlay([{ name: "survived" }], {}),
        modifiedMs,
      },
    ],
    { commit: scan },
    { sensors: statuses, shipped: SHIPPED },
  );

  return model.groups.find((group) => group.name === name);
}

describe("the group header model", () => {
  it("is current with no note and says measured", () => {
    const group = groupOf("mutation", [ran("mutation")]);

    expect(group?.title).toBe("Mutation");
    expect(group?.notes).toEqual([]);
    expect(group?.verb).toBe("measured");
    expect(group?.enabled).toBe(true);
  });

  it("warns when out of date and names the sensor's display name", () => {
    const group = groupOf("crap", [ran("crap")], "ffffffffffff");

    expect(group?.title).toBe("C.R.A.P.");
    expect(group?.notes).toEqual([
      {
        text: "Out of date: measured before your latest commit. Run C.R.A.P. to refresh.",
        tone: "warn",
      },
    ]);
    expect(group?.enabled).toBe(true);
  });

  it("warns of a budgeted partial result and still says measured", () => {
    const group = groupOf("mutation", [
      ran("mutation", { partial: { measured: 245, total: 1545 } }),
    ]);

    expect(group?.notes).toEqual([
      {
        text: "Partial: 245 of 1,545 functions measured. The rest are uncoloured.",
        tone: "warn",
      },
    ]);
    expect(group?.verb).toBe("measured");
  });

  it("says stopped for a stopped run that kept some functions", () => {
    const group = groupOf("mutation", [
      ran("mutation", {
        stopped: { measured: 1, total: 3 },
        partial: { measured: 1, total: 3 },
      }),
    ]);

    expect(group?.verb).toBe("stopped");
    expect(group?.notes[0]?.text).toBe(
      "Partial: 1 of 3 functions measured. The rest are uncoloured.",
    );
    expect(group?.enabled).toBe(true);
  });

  it("disables a run stopped with nothing and says so", () => {
    const group = groupOf("mutation", [
      ran("mutation", {
        stopped: { measured: 0, total: 3 },
        partial: { measured: 0, total: 3 },
      }),
    ]);

    expect(group?.verb).toBe("stopped");
    expect(group?.enabled).toBe(false);
    expect(group?.notes).toEqual([
      {
        text: "Stopped before any function finished, so there is nothing to show.",
        tone: "muted",
      },
    ]);
  });

  it("shows no Partial line for a stopped run that measured every function", () => {
    const group = groupOf("mutation", [
      ran("mutation", { stopped: { measured: 3, total: 3 } }),
    ]);

    expect(group?.verb).toBe("stopped");
    expect(group?.notes).toEqual([]);
  });

  it("puts out of date before partial when both apply", () => {
    const group = groupOf(
      "mutation",
      [ran("mutation", { partial: { measured: 1, total: 3 } })],
      "ffffffffffff",
    );

    expect(group?.notes.map((note) => note.text)).toEqual([
      "Out of date: measured before your latest commit. Run Mutation to refresh.",
      "Partial: 1 of 3 functions measured. The rest are uncoloured.",
    ]);
  });

  it("ignores findings from a different commit than the overlay", () => {
    const group = groupOf("mutation", [
      ran("mutation", {
        commit: "ffffffffffff",
        stopped: { measured: 0, total: 3 },
        partial: { measured: 0, total: 3 },
      }),
    ]);

    expect(group?.notes).toEqual([]);
    expect(group?.verb).toBe("measured");
    expect(group?.enabled).toBe(true);
  });

  it("shows a sensor that never ran as a disabled group built from the shipped list", () => {
    const model = buildOverlayModel(
      [],
      { commit: COMMIT },
      { sensors: [], shipped: SHIPPED },
    );
    const mutation = model.groups.find((group) => group.name === "mutation");

    expect(mutation?.enabled).toBe(false);
    expect(mutation?.measuredAt).toBeNull();
    expect(mutation?.notes).toEqual([
      {
        text: "Not run yet. Run Mutation from the Scan panel.",
        tone: "muted",
      },
    ]);
    expect(model.metrics).toEqual([]);
  });

  it("builds the never-run groups from the real committed list", () => {
    const model = buildOverlayModel(
      [],
      { commit: COMMIT },
      { sensors: [], shipped: SHIPPED },
    );

    expect(model.groups.map((group) => group.title)).toEqual([
      "C.R.A.P.",
      "Mutation",
    ]);
    expect(model.groups.map((group) => group.metrics.length)).toEqual([3, 4]);
  });

  it("marks only the group without findings or overlay as never run", () => {
    const model = buildOverlayModel(
      [
        {
          name: "crap",
          text: overlay([{ name: "crap" }], {}),
          modifiedMs: 1000,
        },
      ],
      { commit: COMMIT },
      { sensors: [ran("crap")], shipped: SHIPPED },
    );
    const [crap, mutation] = model.groups;

    expect(crap?.notes).toEqual([]);
    expect(crap?.enabled).toBe(true);
    expect(mutation?.notes[0]?.text).toBe(
      "Not run yet. Run Mutation from the Scan panel.",
    );
  });

  it("formats the age from the overlay's time at the 59 second and 1 minute boundary", () => {
    const group = groupOf("mutation", [ran("mutation")]);

    expect(group && groupHeader(group, 1000 + 59_000)).toBe(
      "measured just now",
    );
    expect(group && groupHeader(group, 1000 + 60_000)).toBe(
      "measured 1 minute ago",
    );
  });

  it("says stopped in the header of a stopped run and nothing without a time", () => {
    const stopped = groupOf(
      "mutation",
      [ran("mutation", { stopped: { measured: 1, total: 3 } })],
      COMMIT,
      1000,
    );
    const untimed = groupOf("mutation", [ran("mutation")], COMMIT, null);

    expect(stopped && groupHeader(stopped, 1000 + 5 * 60_000)).toBe(
      "stopped 5 minutes ago",
    );
    expect(untimed && groupHeader(untimed, 5000)).toBe("");
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
      "survived",
      "killed",
      "uncovered",
      "score",
    ]) {
      expect(DESCRIPTIONS[name]).toBeTruthy();
      expect(TITLES[name]).toBeTruthy();
    }

    expect(DESCRIPTIONS.mutation_survived).toBeUndefined();

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
  it("drops removed ticks, keeps an out-of-date group's and drops a disabled group's", () => {
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
    expect(pruneTicks(["a/m2", "a/m1"], stale.metrics)).toEqual([
      "a/m2",
      "a/m1",
    ]);

    const disabled = buildOverlayModel(
      [],
      { commit: COMMIT },
      {
        sensors: [],
        shipped: SHIPPED,
      },
    );

    expect(pruneTicks(["mutation/survived"], disabled.metrics)).toEqual([]);
  });
});

describe("currentMetricNamed", () => {
  const text = overlay([{ name: "m1" }], {});
  const fresh = buildOverlayModel([{ name: "a", text }], { commit: COMMIT });
  const stale = buildOverlayModel([{ name: "a", text }], { commit: "other" });

  it("finds a current metric by its name", () => {
    expect(currentMetricNamed("m1", fresh.metrics)?.key).toBe("a/m1");
  });

  it("finds a metric of an out-of-date group", () => {
    expect(currentMetricNamed("m1", stale.metrics)?.key).toBe("a/m1");
  });

  it("finds nothing for an unknown or absent name", () => {
    expect(currentMetricNamed("m2", fresh.metrics)).toBeNull();
    expect(currentMetricNamed(undefined, fresh.metrics)).toBeNull();
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
