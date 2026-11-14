import { buildFreshness, type Scan } from "recognizer";
import { describe, expect, it } from "vitest";
import { NO_CHANGES } from "./footer-scan";
import { type ResultRow, type ResultState, stateText } from "./freshness-model";
import {
  applyFreshness,
  buildOverlayModel,
  currentMetricNamed,
  freshnessNote,
  groupHeader,
  type MetricDescriptor,
  metricEntryOf,
  moduleValue,
  type OverlayGroup,
  pruneTicks,
} from "./overlay-model";
import { NO_RUN, type PanelInput, scanPanel } from "./scan-panel-model";
import type { SensorStatus, ShippedSensors } from "./sensor-run";
import { plainSensor, shippedSensors } from "./shipped-fake";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const H1 = "1".repeat(64);
const H2 = "2".repeat(64);
const H0 = "0".repeat(64);
const TESTS = "a".repeat(64);

const KNOWN: Record<string, string> = {
  "a.py": H1,
  "b.py": H2,
  "ab.py": H1,
  "b.ts": H1,
  "one.py": H1,
  "two.py": H1,
};
const CURRENT = { "a.py": H1 };
const EDITED = { "a.py": H0 };

const NOW = 5_000_000;
const fileScan = {
  modules: ["a.py", "b.py"].map((id) => ({
    id,
    kind: "module",
    members: [{ name: "f", exported: true, kind: "function" }],
  })),
  edges: [],
  foreign: [],
  files: [
    { path: "a.py", hash: H1 },
    { path: "b.py", hash: H2 },
  ],
} as unknown as Scan;
const shippedList: ShippedSensors = {
  status: "ok",
  sensors: ["crap", "mutation", "duplication"].map((name) =>
    plainSensor(name, {
      display: name === "crap" ? "C.R.A.P." : name,
      description: "x",
    }),
  ),
};
const ranWith = (name: string, inputs: Record<string, string>) => ({
  name,
  status: "ran" as const,
  findings: 0,
  modifiedMs: null,
  measured: { inputs, tests: TESTS },
});
const REGISTERED = "sensors:\n  crap: {}\n  mutation: {}\n";
const panel = (sensors: PanelInput["sensors"]) =>
  scanPanel({
    scan: {
      origin: { branch: "main", commit: "abc1234" },
      scannedAt: NOW,
      changes: NO_CHANGES,
      scanning: null,
    },
    config: REGISTERED,
    sensors,
    lines: {
      modules: ["a.py", "b.py"],
      of: () => ({ kind: "current", line: "x" }),
    },
    describedAt: null,
    ticks: {
      describe: false,
      ticked: [],
      once: [],
      onlyView: false,
      suites: {},
      folds: [],
    },
    run: NO_RUN,
    scanning: false,
    now: NOW,
    shipped: shippedList,
    scans: [fileScan],
    freshness: buildFreshness([fileScan], TESTS),
  });

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
  const inputs: Record<string, string> = {};

  for (const group of Object.values(values)) {
    for (const key of Object.keys(group)) {
      const module = key.split("::")[0] as string;

      inputs[module] = KNOWN[module] ?? H1;
    }
  }

  return JSON.stringify({
    overlay_version: 1,
    inputs,
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

function only(
  text: string,
  name = "crap",
  shipped: ShippedSensors | null = null,
): MetricDescriptor {
  const model = buildOverlayModel([{ name, text }], { sensors: [], shipped });

  return (model.metrics.find((metric) => metric.overlay === name) ??
    model.metrics[0]) as MetricDescriptor;
}

describe("tooltips and per-module freshness", () => {
  const text = overlay([{ name: "complexity" }], {});

  it("gives the commit as provenance in the tooltip", () => {
    const model = buildOverlayModel([{ name: "crap", text }]);

    expect(model.groups[0]?.tooltip).toBe("crap 0.1.0 - at 0123456");
  });

  it("appends the modified tree", () => {
    const modified = overlay([{ name: "complexity" }], {}, { modified: true });
    const model = buildOverlayModel([{ name: "crap", text: modified }]);

    expect(model.groups[0]?.tooltip).toBe(
      "crap 0.1.0 - at 0123456, modified tree",
    );
  });

  it("keeps the tooltip the same whatever the scan's commit", () => {
    const stale = overlay([{ name: "complexity" }], {}, { inputs: EDITED });
    const model = buildOverlayModel([{ name: "crap", text: stale }]);

    expect(model.groups[0]?.tooltip).toBe("crap 0.1.0 - at 0123456");
  });
});

describe("a member-granularity overlay judged per module", () => {
  const values = { complexity: { "a.py::f": 3, "b.py::g": 9 } };
  const mixed = (inputs: Record<string, string>, extra = {}) =>
    overlay([{ name: "complexity" }], values, {
      inputs,
      tests: TESTS,
      ...extra,
    });
  const shown = (
    inputs: Record<string, string>,
    measured: Record<string, unknown> = { inputs, tests: TESTS },
    extra = {},
  ) =>
    applyFreshness(
      buildOverlayModel([{ name: "crap", text: mixed(inputs, extra) }], {
        sensors: [],
        shipped: shippedList,
      }),
      panel([{ ...ranWith("crap", inputs), measured }]).freshness,
    );

  it("keeps only the current module's values and counts the other", () => {
    const model = shown({ "a.py": H1, "b.py": H0 });
    const group = model.groups[0];
    const metric = model.metrics[0] as MetricDescriptor;

    expect(group?.enabled).toBe(true);
    expect(group?.notes).toEqual([]);
    expect(metric.values).toEqual({ "a.py::f": 3 });
    expect(metric.max).toBe(3);
    expect(moduleValue(metric, "a.py")?.value).toBe(3);
    expect(moduleValue(metric, "b.py")).toBeNull();
  });

  it("shows no note when every module is current", () => {
    const model = shown({ "a.py": H1, "b.py": H2 });

    expect(model.groups[0]?.notes).toEqual([]);
    expect(model.metrics[0]?.values).toEqual({ "a.py::f": 3, "b.py::g": 9 });
  });

  it("disables the group and lists no metrics when every module is out of date", () => {
    const model = shown({ "a.py": H0, "b.py": H0 });

    expect(model.groups[0]?.enabled).toBe(false);
    expect(model.groups[0]?.notes).toEqual([]);
    expect(model.groups[0]?.metrics[0]?.values).toEqual({});
    expect(model.metrics).toEqual([]);
  });

  it("is out of date everywhere when the tests hash differs", () => {
    const inputs = { "a.py": H1, "b.py": H2 };
    const other = "b".repeat(64);
    const model = shown(inputs, { inputs, tests: other }, { tests: other });

    expect(model.groups[0]?.enabled).toBe(false);
    expect(model.groups[0]?.metrics[0]?.values).toEqual({});
  });

  it("is out of date everywhere with no inputs", () => {
    const model = shown({}, { inputs: {}, tests: TESTS });

    expect(model.groups[0]?.enabled).toBe(true);
    expect(model.groups[0]?.metrics[0]?.values).toEqual({});
  });
});

const SHIPPED: ShippedSensors = {
  status: "ok",
  sensors: shippedSensors().filter((sensor) => sensor.metrics.length > 0),
};

const FULL: ShippedSensors = { status: "ok", sensors: shippedSensors() };

function ran(name: string, over: Partial<SensorStatus> = {}): SensorStatus {
  return { name, status: "ran", commit: COMMIT, findings: 0, ...over };
}

function groupOf(
  name: string,
  statuses: SensorStatus[],
  inputs: Record<string, string> = CURRENT,
  modifiedMs: number | null = 1000,
) {
  const model = buildOverlayModel(
    [
      {
        name,
        text: overlay([{ name: "survived" }], {}, { inputs }),
        modifiedMs,
      },
    ],
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

  it("writes no freshness note when out of date and names the sensor's display name", () => {
    const group = groupOf("crap", [ran("crap")], EDITED);

    expect(group?.title).toBe("C.R.A.P.");
    expect(group?.notes).toEqual([]);
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

  it("keeps only the partial note when both apply", () => {
    const group = groupOf(
      "mutation",
      [ran("mutation", { partial: { measured: 1, total: 3 } })],
      EDITED,
    );

    expect(group?.notes.map((note) => note.text)).toEqual([
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
    const model = buildOverlayModel([], {
      sensors: [],
      shipped: SHIPPED,
    });
    const mutation = model.groups.find((group) => group.name === "mutation");

    expect(mutation?.enabled).toBe(false);
    expect(mutation?.measuredAt).toBeNull();
    expect(mutation?.notes).toEqual([]);
    expect(model.metrics).toEqual(model.groups.flatMap((g) => g.metrics));
  });

  it("builds the never-run groups from the real committed list", () => {
    const model = buildOverlayModel([], {
      sensors: [],
      shipped: SHIPPED,
    });

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
      { sensors: [ran("crap")], shipped: SHIPPED },
    );
    const [crap, mutation] = model.groups;

    expect(crap?.notes).toEqual([]);
    expect(crap?.enabled).toBe(true);
    expect(mutation?.notes).toEqual([]);
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
      CURRENT,
      1000,
    );
    const untimed = groupOf("mutation", [ran("mutation")], CURRENT, null);

    expect(stopped && groupHeader(stopped, 1000 + 5 * 60_000)).toBe(
      "stopped 5 minutes ago",
    );
    expect(untimed && groupHeader(untimed, 5000)).toBe("");
  });
});

describe("descriptors", () => {
  it("keys by overlay and metric and takes max across member entries", () => {
    const metric = only(
      overlay([{ name: "complexity" }], {
        complexity: { "a.py::f": 8, "b.ts::g": 1 },
      }),
    );

    expect(metric.key).toBe("crap/complexity");
    expect(metric.max).toBe(8);
    expect(only(overlay([{ name: "complexity" }], {})).max).toBe(0);
  });

  it("takes title, short and description from the manifest metric of the sensor named by the overlay", () => {
    const metric = only(overlay([{ name: "complexity" }], {}), "crap", FULL);

    expect(metric.title).toBe("Complexity");
    expect(metric.short).toBe("cc");
    expect(metric.description).toBe(
      "How many independent paths run through the function; more paths are harder to test and to change.",
    );
  });

  it("finds a metric through the first sensor that declares it when the overlay is named otherwise", () => {
    const metric = only(
      overlay([{ name: "crap", type: "number" }], {}),
      "custom-crap",
      FULL,
    );

    expect(metric.title).toBe("C.R.A.P.");
    expect(metric.short).toBe("CRAP");
    expect(metricEntryOf(FULL.sensors, "custom-crap", "crap")?.label).toBe(
      "CRAP",
    );
  });

  it("gives the four mutation metrics their short forms", () => {
    const shorts = Object.fromEntries(
      ["killed", "survived", "uncovered", "score"].map((name) => [
        name,
        only(overlay([{ name }], {}), "mutation", FULL).short,
      ]),
    );

    expect(shorts).toEqual({
      killed: "kill",
      survived: "surv",
      uncovered: "unc",
      score: "mut",
    });
  });

  it("shows the raw name and no description for a metric no entry declares", () => {
    const metric = only(overlay([{ name: "line_coverage" }], {}), "crap", FULL);

    expect(metric.title).toBe("line_coverage");
    expect(metric.short).toBe("line_coverage");
    expect(metric.description).toBeUndefined();
  });

  it("shows raw names everywhere when the list is unavailable or null", () => {
    for (const shipped of [
      null,
      { status: "unavailable", reason: "x" } as ShippedSensors,
    ]) {
      const metric = only(overlay([{ name: "crap" }], {}), "crap", shipped);

      expect(metric.title).toBe("crap");
      expect(metric.short).toBe("crap");
      expect(metric.description).toBeUndefined();
    }
  });

  it("skips an entry that lacks the metric and finds it in another sensor", () => {
    const list: ShippedSensors = {
      status: "ok",
      sensors: [plainSensor("custom"), ...shippedSensors()],
    };

    expect(metricEntryOf(list.sensors, "custom", "score")?.label).toBe("mut");
  });

  it("lists a file that fails validation as unreadable and keeps the others", () => {
    const model = buildOverlayModel([
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
    ]);

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
  it("drops removed ticks and keeps those of an out-of-date or disabled group", () => {
    const fresh = buildOverlayModel([
      {
        name: "a",
        text: overlay([{ name: "m1" }, { name: "m2" }], {}),
      },
    ]);
    const stale = buildOverlayModel([
      {
        name: "a",
        text: overlay([{ name: "m1" }, { name: "m2" }], {}, { inputs: EDITED }),
      },
    ]);

    expect(pruneTicks(["a/m2", "gone/x", "a/m1"], fresh.metrics)).toEqual([
      "a/m2",
      "a/m1",
    ]);
    expect(pruneTicks(["a/m2", "a/m1"], stale.metrics)).toEqual([
      "a/m2",
      "a/m1",
    ]);

    const disabled = buildOverlayModel([], {
      sensors: [],
      shipped: SHIPPED,
    });

    expect(pruneTicks(["mutation/survived"], disabled.metrics)).toEqual([
      "mutation/survived",
    ]);
  });
});

describe("currentMetricNamed", () => {
  const text = overlay([{ name: "m1" }], {});
  const fresh = buildOverlayModel([{ name: "a", text }]);

  it("finds a current metric by its name", () => {
    expect(currentMetricNamed("m1", fresh.metrics)?.key).toBe("a/m1");
  });

  it("finds nothing for an unknown or absent name", () => {
    expect(currentMetricNamed("m2", fresh.metrics)).toBeNull();
    expect(currentMetricNamed(undefined, fresh.metrics)).toBeNull();
  });
});

describe("freshnessNote", () => {
  const NOW = 10_000_000;
  const group = { name: "crap", title: "C.R.A.P." } as OverlayGroup;
  const rowOf = (state: ResultState): ResultRow => ({
    key: "crap",
    name: "C.R.A.P.",
    state,
    tickable: true,
    scoped: false,
  });
  const noteOf = (state: ResultState) =>
    freshnessNote(group, rowOf(state), NOW, shippedList);

  it("has no note for a current sensor or a group with no row", () => {
    expect(noteOf({ kind: "current", at: 1 })).toBeNull();
    expect(freshnessNote(group, undefined, NOW, null)).toBeNull();
  });

  it("notes a group with no row as not written by a sensor this repository runs", () => {
    expect(freshnessNote(group, undefined, NOW, shippedList)).toEqual({
      text: "Not written by a sensor this repository runs, so its values are not shown.",
      tone: "muted",
    });
  });

  it("notes a group with no row as unreadable when the sensor list is unavailable", () => {
    expect(
      freshnessNote(group, undefined, NOW, {
        status: "unavailable",
        reason: "failed",
      }),
    ).toEqual({
      text: "The sensor list could not be read, so its values are not shown.",
      tone: "muted",
    });
  });

  it("warns with the count and the call to action when out of date", () => {
    expect(noteOf({ kind: "out-of-date", modules: ["a", "b"] })).toEqual({
      text: "2 modules out of date. Run C.R.A.P. from the Scan panel.",
      tone: "warn",
    });
  });

  it("uses the singular for one out-of-date module", () => {
    expect(noteOf({ kind: "out-of-date", modules: ["a"] })?.text).toBe(
      "1 module out of date. Run C.R.A.P. from the Scan panel.",
    );
  });

  it("mutes the note for a sensor that never ran", () => {
    expect(noteOf({ kind: "never-run" })).toEqual({
      text: "Never run. Run C.R.A.P. from the Scan panel.",
      tone: "muted",
    });
  });

  it("warns for a failed sensor with its age", () => {
    const state: ResultState = { kind: "failed", at: NOW - 120_000 };

    expect(noteOf(state)).toEqual({
      text: `F${stateText(state, NOW).text.slice(1)}. Run C.R.A.P. from the Scan panel.`,
      tone: "warn",
    });
    expect(noteOf(state)?.text).toContain("Failed, ");
  });

  it("warns for a failed sensor without an age", () => {
    expect(noteOf({ kind: "failed", at: null })).toEqual({
      text: "Failed. Run C.R.A.P. from the Scan panel.",
      tone: "warn",
    });
  });

  it("says running with no call to action, with or without progress", () => {
    expect(noteOf({ kind: "running", done: null, total: null })).toEqual({
      text: "Running",
      tone: "muted",
    });
    expect(noteOf({ kind: "running", done: 3, total: 10 })?.text).toBe(
      "3 of 10",
    );
  });

  it("states the same text as the freshness model for the same state", () => {
    const state: ResultState = {
      kind: "out-of-date",
      modules: ["a", "b", "c"],
    };

    expect(
      noteOf(state)?.text.startsWith(`${stateText(state, NOW).text}.`),
    ).toBe(true);
  });
});

describe("freshnessNote against the Scan panel model", () => {
  const groupFor = (name: string, title: string) =>
    ({ name, title }) as OverlayGroup;
  const noteFor = (model: ReturnType<typeof scanPanel>, name: string) => {
    const row = model.freshness.rows.find((one) => one.key === name);

    return freshnessNote(
      groupFor(name, row?.name ?? name),
      row,
      NOW,
      shippedList,
    );
  };

  it("counts the same modules and words the state the same as the row", () => {
    const model = panel([ranWith("crap", { "a.py": H1, "b.py": H0 })]);
    const row = model.freshness.rows.find(({ key }) => key === "crap");
    const state = row?.state;

    expect(state?.kind).toBe("out-of-date");

    const modules = state?.kind === "out-of-date" ? state.modules.length : -1;
    const text = stateText(row?.state as ResultState, NOW).text;

    expect(noteFor(model, "crap")?.text).toBe(
      `${text}. Run C.R.A.P. from the Scan panel.`,
    );
    expect(text).toBe(`${modules} module out of date`);
  });

  it("gives none, the out-of-date note and none for current, out of date and no row", () => {
    const model = panel([
      ranWith("mutation", { "a.py": H1, "b.py": H2 }),
      ranWith("crap", { "a.py": H1, "b.py": H0 }),
    ]);

    expect(noteFor(model, "mutation")).toBeNull();
    expect(noteFor(model, "crap")?.text).toBe(
      "1 module out of date. Run C.R.A.P. from the Scan panel.",
    );
    expect(noteFor(model, "stray")?.tone).toBe("muted");
  });

  describe("applyFreshness", () => {
    const FILE_FRESH = buildFreshness([fileScan], TESTS);
    const values = { complexity: { "a.py::f": 1, "b.py::f": 2 } };
    const file = (name: string, inputs: Record<string, string>) => ({
      name,
      text: overlay([{ name: "complexity" }], values, { inputs, tests: TESTS }),
    });
    const build = (
      files: ReturnType<typeof file>[],
      shipped: ShippedSensors = shippedList,
    ) => buildOverlayModel(files, { sensors: [], shipped });
    const stale = { "a.py": H0, "b.py": H0 };
    const partly = { "a.py": H1, "b.py": H0 };
    const whole = { "a.py": H1, "b.py": H2 };
    const enabledOf = (model: ReturnType<typeof build>, name: string) =>
      model.groups.find((group) => group.name === name)?.enabled;
    const rowState = (
      kind: ResultState["kind"],
      stale: string[] = ["a.py", "b.py"],
    ): ReturnType<typeof panel>["freshness"] => {
      const base = panel([]).freshness;
      const state = {
        current: { kind: "current", at: null },
        "never-run": { kind: "never-run" },
        failed: { kind: "failed", at: null },
        running: { kind: "running", done: null, total: null },
        "out-of-date": { kind: "out-of-date", modules: ["a.py"] },
      }[kind] as ResultState;

      return {
        ...base,
        rows: [
          {
            key: "crap",
            name: "C.R.A.P.",
            state,
            tickable: true,
            scoped: false,
          },
        ],
        modules: new Set(["a.py", "b.py"]),
        stale: new Map([["crap", new Set(stale)]]),
      };
    };

    it("disables a group that is out of date with no current value", () => {
      const model = build([file("crap", stale)]);
      const applied = applyFreshness(
        model,
        panel([ranWith("crap", stale)]).freshness,
      );

      expect(enabledOf(applied, "crap")).toBe(false);
      expect(applied.metrics).toEqual([]);
    });

    it("enables a group out of date with exactly one current value", () => {
      const model = build([file("crap", partly)]);
      const applied = applyFreshness(
        model,
        panel([ranWith("crap", partly)]).freshness,
      );

      expect(enabledOf(applied, "crap")).toBe(true);
      expect(applied.metrics[0]?.values).toEqual({ "a.py::f": 1 });
    });

    it("enables a group out of date with several current values", () => {
      const model = build([file("crap", whole)]);
      const applied = applyFreshness(model, rowState("out-of-date", []));

      expect(enabledOf(applied, "crap")).toBe(true);
      expect(applied.metrics).toHaveLength(1);
      expect(applied.metrics[0]?.values).toEqual(values.complexity);
    });

    it.each(["current", "never-run", "failed", "running"] as const)(
      "keeps a %s group enabled even with no current value",
      (kind) => {
        const model = build([file("crap", stale)]);
        const applied = applyFreshness(model, rowState(kind));

        expect(enabledOf(applied, "crap")).toBe(true);
        expect(applied.metrics[0]?.values).toEqual({});
        expect(applied.metrics[0]?.max).toBe(0);
      },
    );

    it("disables a group with no row", () => {
      const model = build([file("stray", stale)]);
      const applied = applyFreshness(model, panel([]).freshness);

      expect(enabledOf(applied, "stray")).toBe(false);
      expect(applied.metrics).toEqual([]);
    });

    it("keeps a shipped sensor with no file disabled whatever its row says", () => {
      const model = build([], SHIPPED);
      const applied = applyFreshness(model, rowState("current"));

      expect(enabledOf(model, "crap")).toBe(false);
      expect(enabledOf(applied, "crap")).toBe(false);
      expect(applied.metrics).toEqual([]);
    });

    it("lists exactly the enabled groups' metrics for a mixed model", () => {
      const model = build([
        file("crap", stale),
        file("mutation", partly),
        file("stray", stale),
      ]);
      const applied = applyFreshness(
        model,
        panel([ranWith("crap", stale), ranWith("mutation", partly)]).freshness,
      );

      expect(applied.groups.map((group) => group.enabled)).toEqual([
        false,
        true,
        false,
      ]);
      expect(applied.metrics.map((metric) => metric.overlay)).toEqual([
        "mutation",
      ]);
    });

    it("disables a group exactly when its note says out of date and no value is current", () => {
      for (const inputs of [stale, partly, whole]) {
        const model = build([file("crap", inputs)]);
        const freshness = panel([ranWith("crap", inputs)]).freshness;
        const applied = applyFreshness(model, freshness);
        const group = model.groups[0] as OverlayGroup;
        const row = freshness.rows.find((one) => one.key === "crap");
        const note = freshnessNote(
          { ...group, title: "C.R.A.P." },
          row,
          NOW,
          shippedList,
        );
        const outOfDate = row?.state.kind === "out-of-date";
        const empty = applied.groups[0]?.metrics.every(
          (metric) => Object.keys(metric.values).length === 0,
        );

        expect(enabledOf(applied, "crap")).toBe(!(outOfDate && empty));
        expect(note === null).toBe(!outOfDate);
      }
    });

    it("drops every value of a group with no entry and recomputes max for one with a mixed entry", () => {
      const model = build([file("crap", partly), file("stray", whole)]);
      const applied = applyFreshness(
        model,
        panel([ranWith("crap", partly)]).freshness,
      );
      const crap = applied.groups.find((group) => group.name === "crap");
      const stray = applied.groups.find((group) => group.name === "stray");

      expect(crap?.metrics[0]?.values).toEqual({ "a.py::f": 1 });
      expect(crap?.metrics[0]?.max).toBe(1);
      expect(stray?.metrics[0]?.values).toEqual({});
      expect(stray?.metrics[0]?.max).toBe(0);
    });

    it("drops a value whose module is not in the model's modules", () => {
      const model = buildOverlayModel(
        [
          {
            name: "crap",
            text: overlay(
              [{ name: "complexity" }],
              { complexity: { "a.py::f": 1, "gone.py::f": 5 } },
              { inputs: whole, tests: TESTS },
            ),
          },
        ],
        { sensors: [], shipped: shippedList },
      );
      const applied = applyFreshness(
        model,
        panel([ranWith("crap", whole)]).freshness,
      );

      expect(applied.metrics[0]?.values).toEqual({ "a.py::f": 1 });
      expect(applied.metrics[0]?.max).toBe(1);
    });

    it("keeps exactly the keys freshness.current accepts", () => {
      for (const inputs of [stale, partly, whole]) {
        const model = build([file("crap", inputs)]);
        const applied = applyFreshness(
          model,
          panel([ranWith("crap", inputs)]).freshness,
        );
        const accepted = Object.keys(values.complexity).filter((key) =>
          FILE_FRESH.current(
            { inputs, tests: TESTS },
            FILE_FRESH.moduleOf(key),
          ),
        );

        expect(Object.keys(applied.metrics[0]?.values ?? {})).toEqual(accepted);
      }
    });

    it("enables a group whose stale modules are outside the view", () => {
      const model = build([file("crap", partly)]);
      const input = panel([ranWith("crap", partly)]).freshness;
      const scoped = scanPanel({
        scan: {
          origin: { branch: "main", commit: "abc1234" },
          scannedAt: NOW,
          changes: NO_CHANGES,
          scanning: null,
        },
        config: REGISTERED,
        sensors: [ranWith("crap", partly)],
        lines: {
          modules: ["a.py"],
          of: () => ({ kind: "current", line: "x" }),
        },
        describedAt: null,
        ticks: {
          describe: false,
          ticked: [],
          once: [],
          onlyView: true,
          suites: {},
          folds: [],
        },
        view: { name: "v", modules: ["a.py"] } as never,
        run: NO_RUN,
        scanning: false,
        now: NOW,
        shipped: shippedList,
        scans: [fileScan],
        freshness: buildFreshness([fileScan], TESTS),
      }).freshness;
      const row = scoped.rows.find((one) => one.key === "crap");
      const applied = applyFreshness(model, scoped);

      expect(input.rows.find((one) => one.key === "crap")?.state.kind).toBe(
        "out-of-date",
      );
      expect(row?.state.kind).toBe("current");
      expect(enabledOf(applied, "crap")).toBe(true);
      expect(
        freshnessNote(
          { name: "crap", title: "C.R.A.P." } as OverlayGroup,
          row,
          NOW,
          shippedList,
        ),
      ).toBeNull();
    });
  });
});
