import { execFileSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../scripts/temp-dirs.mjs";
import { run } from "../src/cli.js";
import { capture, REPO } from "./helpers.js";
import {
  type Fake,
  type FakeOptions,
  fakeIo,
  type Program,
  PYTHON,
  ROOT,
} from "./scan-helpers.js";

const COMMIT = "abc123";
const read = (path: string) => readFileSync(join(REPO, path), "utf8");
const checkScan = JSON.parse(read("fixtures/check/scan.json"));
const CONFIG = `${ROOT}/.recognizer/config.yaml`;
const STRUCTURE = `${ROOT}/.recognizer/cache/findings/structure.json`;
const FAKE = `${ROOT}/.recognizer/cache/findings/fake-sensor.json`;
const BASELINE = `${ROOT}/.recognizer/baselines/violations.json`;

function cached(commit = COMMIT) {
  return JSON.stringify({ ...checkScan, commit, modified: false, files: [] });
}

function fakeDocument(changes: Record<string, unknown> = {}) {
  return JSON.stringify({
    findings_version: 1,
    sensor: { name: "fake-sensor", version: "1" },
    commit: COMMIT,
    modified: false,
    settings: {},
    findings: [
      {
        id: "fake-violation:shop/main.py",
        kind: "fake-violation",
        severity: "violation",
        principle: "fake-principle",
        summary: "the fake sensor objects",
        evidence: { modules: ["shop/main.py"] },
      },
    ],
    ...changes,
  });
}

function sensor(content: string | null, status = 0): Program {
  return (args, files) => {
    if (content !== null) {
      files.set(args[args.length - 1] as string, content);
    }

    return status === 0 ? undefined : { status, stderr: "broke" };
  };
}

function setup(yaml: string | null, options: FakeOptions = {}): Fake {
  return fakeIo({
    commit: COMMIT,
    ...options,
    scanners: { [PYTHON]: {}, ...options.scanners },
    files: {
      [`${ROOT}/shop/a.py`]: "",
      [`${ROOT}/.recognizer/cache/scan.python.json`]: cached(),
      [`${ROOT}/.recognizer/policy.yaml`]: read(
        "fixtures/check/.recognizer/policy.yaml",
      ),
      [BASELINE]: read("fixtures/check/.recognizer/baselines/violations.json"),
      ...(yaml === null ? {} : { [CONFIG]: yaml }),
      ...options.files,
    },
  });
}

const REGISTER =
  'sensors:\n  fake-sensor:\n    command: [fake-sensor, "{commit}", "{output}"]\n';

function check(fake: Fake, ...argv: string[]) {
  const code = run(["check", "--repository", ROOT, ...argv], fake.io);

  return { code, out: fake.out(), err: fake.err() };
}

function sense(fake: Fake, names = "all", ...argv: string[]) {
  const code = run(["scan", ROOT, "--sense", names, ...argv], fake.io);

  return { code, out: fake.out(), err: fake.err() };
}

function senseReport(out: string) {
  const events = out
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line));
  const summary = events.find((one) => one.event === "summary");

  return {
    commit: summary.commit,
    modified: summary.modified,
    sensors: events
      .filter((one) => one.event === "entry" && one.phase === "sense")
      .map((one) => ({
        name: one.name,
        status: one.outcome === "ok" ? "ran" : "failed",
        reason: one.reason,
      })),
  };
}

describe("scan --sense running a registered sensor", () => {
  it("writes the sensor's findings file and check then puts its violation through the baseline", () => {
    const fake = setup(REGISTER, {
      programs: { "fake-sensor": sensor(fakeDocument()) },
    });

    const sensed = sense(fake);

    expect(sensed.code).toBe(0);
    expect(sensed.out).toBe(
      "extract\nscans current at abc123\nsense\nran fake-sensor\n",
    );
    expect(fake.files.has(FAKE)).toBe(true);

    const { code, out } = check(fake, "--json");
    const report = JSON.parse(out.slice(sensed.out.length));

    expect(code).toBe(1);
    expect(report.violations).toHaveLength(6);
    expect(report.new).toHaveLength(5);
    expect(
      report.new.map((v: { finding_id?: string }) => v.finding_id),
    ).toContain("fake-violation:shop/main.py");
    expect(
      report.sensors.map((s: { name: string; status: string }) => [
        s.name,
        s.status,
      ]),
    ).toEqual([
      ["structure", "ran"],
      ["fake-sensor", "ran"],
    ]);
  });

  it("prints the outcome as JSON", () => {
    const fake = setup(REGISTER, {
      programs: { "fake-sensor": sensor(fakeDocument()) },
    });
    const report = senseReport(sense(fake, "all", "--json").out);

    expect(report).toMatchObject({
      commit: COMMIT,
      sensors: [{ name: "fake-sensor", status: "ran" }],
    });
  });

  it("runs only the named sensors and refuses an unknown name with the registered ones", () => {
    const two = `${REGISTER}  other:\n    command: [other-sensor, "{output}"]\n`;
    const fake = setup(two, {
      programs: { "fake-sensor": sensor(fakeDocument()) },
    });

    expect(sense(fake, "fake-sensor").code).toBe(0);
    expect(fake.calls.some((call) => call.command === "other-sensor")).toBe(
      false,
    );

    const refused = sense(fake, "nope");

    expect(refused.code).toBe(2);
    expect(refused.err).toContain("no such sensor: nope");
    expect(refused.err).toContain("registered sensors: fake-sensor, other");
  });

  it("refuses a repository with no sensor registered", () => {
    const refused = sense(setup(null));

    expect(refused.code).toBe(2);
    expect(refused.err).toContain("no sensors are registered");
  });

  it.each([
    ["exits non-zero", sensor(null, 3)],
    ["writes nothing", sensor(null)],
    ["writes invalid JSON", sensor("{")],
    [
      "writes another sensor's name",
      sensor(fakeDocument({ sensor: { name: "someone-else", version: "1" } })),
    ],
    ["writes the wrong commit", sensor(fakeDocument({ commit: "other" }))],
    [
      "writes duplicate ids",
      sensor(
        JSON.stringify({
          ...JSON.parse(fakeDocument()),
          findings: [
            ...JSON.parse(fakeDocument()).findings,
            ...JSON.parse(fakeDocument()).findings,
          ],
        }),
      ),
    ],
  ])(
    "reports a sensor that %s by name, leaves no file and exits 1",
    (_, program) => {
      const fake = setup(REGISTER, {
        programs: { "fake-sensor": program },
        files: { [FAKE]: fakeDocument() },
      });
      const { code, err, out } = sense(fake, "all", "--json");

      expect(code).toBe(1);
      expect(err).toContain("failed fake-sensor:");
      expect(fake.files.has(FAKE)).toBe(false);
      expect(senseReport(out).sensors[0]).toMatchObject({
        name: "fake-sensor",
        status: "failed",
      });
    },
  );

  it("fails the run for a missing program", () => {
    const { code, err } = sense(setup(REGISTER));

    expect(code).toBe(1);
    expect(err).toContain("failed fake-sensor:");
  });
});

describe("check reading registered sensors", () => {
  it("never runs a registered sensor and reports one with no file as missing", () => {
    const fake = setup(REGISTER, {
      programs: { "fake-sensor": sensor(fakeDocument()) },
    });
    const report = JSON.parse(check(fake, "--json").out);

    expect(fake.calls.some((call) => call.command === "fake-sensor")).toBe(
      false,
    );
    expect(fake.files.has(FAKE)).toBe(false);
    expect(report.sensors).toContainEqual({
      name: "fake-sensor",
      status: "missing",
    });
    expect(report.violations).toHaveLength(5);
  });

  it("accepts the sensor's violation once the baseline lists it by id", () => {
    const yaml = `${REGISTER}  structure:\n    hub_threshold: 10\n`;
    const baseline = JSON.stringify({
      schema_version: 1,
      violations: [{ id: "fake-violation:shop/main.py" }],
    });
    const fake = setup(yaml, {
      files: { [BASELINE]: `${baseline}\n`, [FAKE]: fakeDocument() },
    });
    const report = JSON.parse(check(fake, "--json").out);

    expect(
      report.new.map((v: { finding_id?: string }) => v.finding_id),
    ).not.toContain("fake-violation:shop/main.py");
  });

  it("ignores a leftover file from another commit and reports it stale", () => {
    const fake = setup(REGISTER, {
      files: { [FAKE]: fakeDocument({ commit: "old" }) },
    });
    const { code, err, out } = check(fake, "--json");
    const report = JSON.parse(out);

    expect(err).toContain("stale fake-sensor");
    expect(report.violations).toHaveLength(5);
    expect(report.sensors).toContainEqual({
      name: "fake-sensor",
      status: "stale",
    });
    expect(code).toBe(1);
  });

  it("does not let a stale file change the exit code", () => {
    const fake = setup(REGISTER, {
      files: {
        [FAKE]: fakeDocument({ commit: "old" }),
        [BASELINE]: JSON.stringify({
          schema_version: 1,
          violations: JSON.parse(read("fixtures/check/expected.json"))
            .violations.map(
              ({
                from,
                to,
                kind,
              }: {
                from: string;
                to: string;
                kind: string;
              }) => ({ from, to, kind }),
            )
            .sort(
              (
                a: { from: string; to: string },
                b: { from: string; to: string },
              ) =>
                a.from === b.from
                  ? a.to < b.to
                    ? -1
                    : 1
                  : a.from < b.from
                    ? -1
                    : 1,
            ),
        }),
      },
    });

    expect(check(fake).code).toBe(0);
  });

  it("reads a baseline mixing an identity entry and an id entry", () => {
    const baseline = JSON.stringify({
      schema_version: 1,
      violations: [
        {
          from: "shop/domain/order.py",
          to: "shop/adapters/memory_store.py",
          kind: "depends",
        },
        { id: "fake-violation:gone" },
      ],
    });
    const fake = setup(REGISTER, {
      files: { [BASELINE]: `${baseline}\n`, [FAKE]: fakeDocument() },
    });
    const report = JSON.parse(check(fake, "--json").out);

    expect(report.fixed).toEqual([{ id: "fake-violation:gone" }]);
    expect(report.new).toHaveLength(5);
    expect(
      report.new.map(
        (v: { finding_id?: string }) => v.finding_id ?? "structure",
      ),
    ).toContain("fake-violation:shop/main.py");
  });
});

describe("check ratcheting a thresholds violation", () => {
  const THRESHOLDS = `${ROOT}/.recognizer/cache/findings/thresholds.json`;
  const ID = "thresholds:churn:app/billing.py";
  const YAML =
    'sensors:\n  thresholds:\n    command: [thresholds, "{commit}", "{output}"]\n';

  function thresholdsDocument() {
    return JSON.stringify({
      findings_version: 1,
      sensor: { name: "thresholds", version: "1" },
      commit: COMMIT,
      modified: false,
      settings: {},
      findings: [
        {
          id: ID,
          kind: "thresholds.churn",
          severity: "violation",
          principle: "churn",
          metric: "churn",
          summary: "app/billing.py: churn 25 is at or above 20",
          evidence: {
            modules: ["app/billing.py"],
            measures: { value: 25, line: 20 },
            producer: "quality-tool",
          },
        },
        {
          id: "thresholds:complexity:app/billing.py::price",
          kind: "thresholds.complexity",
          severity: "warning",
          principle: "functions-stay-small",
          metric: "complexity",
          summary: "app/billing.py::price: complexity 14 is at or above 10",
          evidence: { modules: ["app/billing.py"] },
        },
      ],
    });
  }

  const findingIds = (list: { finding_id?: string }[]) =>
    list.map((v) => v.finding_id);

  it("reports the violation as new, writes it by id, then reports it baselined", () => {
    const fake = setup(YAML, { files: { [THRESHOLDS]: thresholdsDocument() } });
    const first = JSON.parse(check(fake, "--json").out);

    expect(findingIds(first.new)).toContain(ID);
    expect(findingIds(first.new)).not.toContain(
      "thresholds:complexity:app/billing.py::price",
    );

    fake.files.delete(BASELINE);
    check(fake, "--init-baseline");

    const baseline = JSON.parse(fake.files.get(BASELINE) as string);

    expect(baseline.violations).toContainEqual({ id: ID });

    const printed = fake.out().length;
    const second = JSON.parse(check(fake, "--json").out.slice(printed));

    expect(findingIds(second.new)).not.toContain(ID);
  });
});

describe("check running the structure sensor", () => {
  it("writes structure.json through a temp file and a rename, recording the settings", () => {
    const fake = setup(null);
    const { err, out } = check(fake);
    const document = JSON.parse(fake.files.get(STRUCTURE) as string);

    expect(fake.renames).toContainEqual({
      from: `${STRUCTURE}.tmp`,
      to: STRUCTURE,
    });
    expect(fake.files.has(`${STRUCTURE}.tmp`)).toBe(false);
    expect(document.settings).toEqual({
      hub_threshold: 10,
      distance_threshold: 0.3,
      entry_points: [],
      warnings: {
        cycle: true,
        hub: true,
        folder_cycle: true,
        orphan: true,
        policy_drift: true,
        stable_dependencies: true,
        stable_abstractions: true,
        unused_exports: false,
      },
    });
    expect(document.commit).toBe(COMMIT);
    expect(out.split("\n")[0]).toBe(
      "sensor structure: hub_threshold 10, distance_threshold 0.3, cycle on, hub on, folder_cycle on, orphan on, policy_drift on, stable_dependencies on, stable_abstractions on, unused_exports off",
    );
    expect(err).toBe("");
  });

  it("writes no file and removes an old one when structure is off", () => {
    const fake = setup("sensors:\n  structure: off\n", {
      files: { [STRUCTURE]: "{}" },
    });
    const { out } = check(fake, "--json");
    const report = JSON.parse(out);

    expect(fake.files.has(STRUCTURE)).toBe(false);
    expect(report.sensors).toEqual([{ name: "structure", status: "off" }]);
    expect(report.violations).toEqual([]);
    expect(report.thresholds).toBeUndefined();
  });

  it("produces no hub warning when the hub switch is off", () => {
    const fake = setup(
      "sensors:\n  structure:\n    hub_threshold: 1\n    warnings:\n      hub: false\n",
    );
    const report = JSON.parse(check(fake, "--json").out);

    expect(report.warnings.some((w: { id: string }) => w.id === "hub")).toBe(
      false,
    );
  });

  it("reads hub_threshold from the config as --hub-threshold does", () => {
    const fromConfig = JSON.parse(
      check(setup("sensors:\n  structure:\n    hub_threshold: 2\n"), "--json")
        .out,
    );
    const fromFlag = JSON.parse(
      check(setup(null), "--hub-threshold", "2", "--json").out,
    );

    expect(fromConfig.warnings).toEqual(fromFlag.warnings);
    expect(fromConfig.thresholds).toEqual({ hub: 2 });
  });

  it("lets the flag beat the config and records the flag's value", () => {
    const fake = setup("sensors:\n  structure:\n    hub_threshold: 2\n");
    const { out } = check(fake, "--hub-threshold", "5");

    expect(
      JSON.parse(fake.files.get(STRUCTURE) as string).settings.hub_threshold,
    ).toBe(5);
    expect(out.split("\n")[0]).toContain("hub_threshold 5");
  });

  it("leaves no structure.json and exits 1 when the rename fails", () => {
    const fake = setup(null);
    const original = fake.io.rename;

    fake.io.rename = (from, to) => {
      if (to === STRUCTURE) {
        throw new Error("disk full");
      }

      original(from, to);
    };

    const { code, err } = check(fake);

    expect(code).toBe(1);
    expect(err).toContain("failed structure: disk full");
    expect(fake.files.has(STRUCTURE)).toBe(false);
    expect(fake.files.has(`${STRUCTURE}.tmp`)).toBe(false);
  });

  it("writes nothing in --scan replay", () => {
    const fake = fakeIo({ files: { "x.json": JSON.stringify(checkScan) } });

    run(["check", "--scan", "x.json"], fake.io);

    expect(fake.writes).toEqual([]);
  });
});

describe("show and modules read the findings files", () => {
  const MODULE = "shop/domain/order.py";

  function show(fake: Fake, ...extra: string[]) {
    const code = run(
      ["show", MODULE, "--repository", ROOT, "--json", ...extra],
      fake.io,
    );

    return { code, out: fake.out(), err: fake.err() };
  }

  it("writes structure.json when it is missing", () => {
    const fake = setup(null);

    show(fake);

    expect(fake.files.has(STRUCTURE)).toBe(true);
  });

  it("writes nothing when a fresh file already exists", () => {
    const fake = setup(null);

    show(fake);

    const before = fake.writes.length;

    show(fake);

    expect(fake.writes.length).toBe(before);
  });

  it("regenerates a file for another commit", () => {
    const stale = JSON.stringify({
      findings_version: 1,
      sensor: { name: "structure", version: "1" },
      commit: "old",
      modified: false,
      settings: {
        hub_threshold: 10,
        entry_points: [],
        warnings: {
          cycle: true,
          hub: true,
          folder_cycle: true,
          orphan: true,
          policy_drift: true,
          stable_dependencies: true,
          stable_abstractions: true,
          unused_exports: false,
        },
      },
      findings: [],
    });
    const fake = setup(null, { files: { [STRUCTURE]: stale } });

    show(fake);

    expect(JSON.parse(fake.files.get(STRUCTURE) as string).commit).toBe(COMMIT);
  });

  it("regenerates a current file that records the settings from before the new warnings", () => {
    const old = JSON.stringify({
      findings_version: 1,
      sensor: { name: "structure", version: "1" },
      commit: COMMIT,
      modified: false,
      settings: { hub_threshold: 10, warnings: { cycle: true, hub: true } },
      findings: [],
    });
    const fake = setup(null, { files: { [STRUCTURE]: old } });

    show(fake);

    const written = JSON.parse(fake.files.get(STRUCTURE) as string);

    expect(written.sensor.version).toBe("5");
    expect(written.settings.entry_points).toEqual([]);
  });

  it("regenerates a current file that records the previous settings shape", () => {
    const previous = JSON.stringify({
      findings_version: 1,
      sensor: { name: "structure", version: "2" },
      commit: COMMIT,
      modified: false,
      settings: {
        hub_threshold: 10,
        entry_points: [],
        warnings: {
          cycle: true,
          hub: true,
          folder_cycle: true,
          orphan: true,
          policy_drift: true,
        },
      },
      findings: [],
    });
    const fake = setup(null, { files: { [STRUCTURE]: previous } });

    show(fake);

    const written = JSON.parse(fake.files.get(STRUCTURE) as string);

    expect(written.sensor.version).toBe("5");
    expect(written.settings.distance_threshold).toBe(0.3);
  });

  it("regenerates when the config's settings differ from the file's", () => {
    const fake = setup(null);

    show(fake);

    const withConfig = setup("sensors:\n  structure:\n    hub_threshold: 4\n", {
      files: { [STRUCTURE]: fake.files.get(STRUCTURE) as string },
    });

    show(withConfig);

    expect(
      JSON.parse(withConfig.files.get(STRUCTURE) as string).settings
        .hub_threshold,
    ).toBe(4);
  });

  it("regenerates every time on a modified tree", () => {
    const fake = setup(null, {
      status: " M shop/a.py\n",
      scanners: {
        [PYTHON]: {
          output: JSON.stringify({
            ...checkScan,
            commit: COMMIT,
            modified: true,
            files: [],
          }),
        },
      },
    });

    show(fake);
    show(fake);

    expect(
      fake.writes.filter((path) => path.endsWith("structure.json.tmp")).length,
    ).toBe(4);
  });

  it("does not write under --hub-threshold", () => {
    const fake = setup(null);

    show(fake, "--hub-threshold", "2");

    expect(fake.files.has(STRUCTURE)).toBe(false);
  });

  it("reads nothing for structure when it is off", () => {
    const fake = setup("sensors:\n  structure: off\n", {
      files: { [STRUCTURE]: "{}" },
    });
    const { out } = show(fake);

    expect(JSON.parse(out).findings ?? []).toEqual([]);
    expect(fake.files.get(STRUCTURE)).toBe("{}");
  });

  it("ignores a registered sensor's file from another commit with a stale line", () => {
    const fake = setup(REGISTER, {
      files: { [FAKE]: fakeDocument({ commit: "old" }) },
    });
    const { err } = show(fake);

    expect(err).toContain("stale fake-sensor");
  });

  it("includes a registered sensor's current findings and never runs it", () => {
    const fake = setup(REGISTER, {
      programs: { "fake-sensor": sensor(fakeDocument()) },
      files: {
        [FAKE]: fakeDocument({
          findings: [
            {
              id: "x:1",
              kind: "x",
              severity: "warning",
              principle: "p",
              summary: "from the file",
              evidence: { modules: [MODULE] },
            },
          ],
        }),
      },
    });
    const { out } = show(fake);

    expect(out).toContain("from the file");
    expect(fake.calls.some((call) => call.command === "fake-sensor")).toBe(
      false,
    );
  });

  it("reports an invalid registered file as invalid", () => {
    const fake = setup(REGISTER, { files: { [FAKE]: "{}" } });

    expect(show(fake).err).toContain("invalid fake-sensor:");
  });
});

describe("a findings file for a sensor no longer registered", () => {
  it("is removed by check with one stderr line and contributes nothing", () => {
    const fake = setup(REGISTER, {
      programs: { "fake-sensor": sensor(fakeDocument()) },
    });

    sense(fake);
    expect(fake.files.has(FAKE)).toBe(true);

    fake.files.set(CONFIG, "sensors:\n  structure:\n    hub_threshold: 10\n");

    const { err, out } = check(fake, "--json");
    const report = JSON.parse(out.slice(out.indexOf("{")));

    expect(err).toContain("removed unregistered fake-sensor\n");
    expect(fake.files.has(FAKE)).toBe(false);
    expect(
      report.new.map((v: { finding_id?: string }) => v.finding_id),
    ).not.toContain("fake-violation:shop/main.py");
    expect(report.sensors.map((s: { name: string }) => s.name)).toEqual([
      "structure",
    ]);
  });

  it("is ignored by show and left in place", () => {
    const fake = setup(null, { files: { [FAKE]: fakeDocument() } });
    const code = run(
      ["show", "shop/main.py", "--repository", ROOT, "--json"],
      fake.io,
    );
    const out = fake.out();
    const err = fake.err();

    expect(code).toBe(0);
    expect(out).not.toContain("the fake sensor objects");
    expect(err).toContain("ignored unregistered fake-sensor");
    expect(fake.files.has(FAKE)).toBe(true);
  });
});

describe("a findings file for a shipped sensor with no config entry", () => {
  const CRAP = `${ROOT}/.recognizer/cache/findings/crap.json`;
  const crapDocument = () =>
    fakeDocument({ sensor: { name: "crap", version: "1" } });

  it("is kept by check and read by show", () => {
    const fake = setup("sensors:\n  structure:\n    hub_threshold: 10\n", {
      files: { [CRAP]: crapDocument() },
    });

    const { err } = check(fake, "--json");

    expect(err).not.toContain("removed unregistered crap");
    expect(fake.files.has(CRAP)).toBe(true);

    const code = run(
      ["show", "shop/main.py", "--repository", ROOT, "--json"],
      fake.io,
    );

    expect(code).toBe(0);
    expect(fake.out()).toContain("the fake sensor objects");
    expect(fake.err()).not.toContain("ignored unregistered crap");
  });

  it("is not reported missing when it never ran", () => {
    const fake = setup("sensors:\n  structure:\n    hub_threshold: 10\n");
    const { out } = check(fake, "--json");
    const report = JSON.parse(out.slice(out.indexOf("{")));

    expect(report.sensors.map((s: { name: string }) => s.name)).toEqual([
      "structure",
    ]);
  });

  it("still removes a third-party name that is neither registered nor shipped", () => {
    const fake = setup("sensors:\n  structure:\n    hub_threshold: 10\n", {
      files: { [FAKE]: fakeDocument() },
    });

    expect(check(fake, "--json").err).toContain(
      "removed unregistered fake-sensor\n",
    );
    expect(fake.files.has(FAKE)).toBe(false);
  });
});

describe("scan --sense leaves a running record while it works", () => {
  const TWO =
    'sensors:\n  first:\n    command: [first-sensor, "{commit}", "{output}"]\n  second:\n    command: [second-sensor, "{commit}", "{output}"]\n';
  const LOG = `${ROOT}/.recognizer/cache/log`;

  function saved(fake: Fake) {
    const names = [...fake.files.keys()].filter((key) =>
      key.startsWith(`${LOG}/`),
    );

    return names.map((name) => JSON.parse(fake.files.get(name) as string));
  }

  it("holds one entry after the first child returns and a running outcome when the second throws", () => {
    let snapshot: unknown[] = [];
    const fake = setup(TWO, {
      programs: {
        "first-sensor": (args, files) => {
          files.set(
            args[args.length - 1] as string,
            fakeDocument({ sensor: { name: "first", version: "1" } }),
          );

          return undefined;
        },
        "second-sensor": (_args, files) => {
          snapshot = [...files.keys()]
            .filter((key) => key.startsWith(`${LOG}/`))
            .map((key) => JSON.parse(files.get(key) as string));

          throw new Error("killed");
        },
      },
    });

    expect(run(["scan", ROOT, "--sense", "all"], fake.io)).not.toBe(0);
    expect(fake.err()).toContain("killed");

    expect(snapshot).toHaveLength(1);

    const [record] = saved(fake);

    expect(saved(fake)).toHaveLength(1);
    expect(record).toMatchObject({
      kind: "scan",
      outcome: "running",
      finished: null,
    });
    expect(record.phases.map((one: { phase: string }) => one.phase)).toEqual([
      "extract",
      "sense",
    ]);
    expect(
      record.phases[1].entries.map((one: { name: string }) => one.name),
    ).toEqual(["first"]);

    const listed = run(["log", "--repository", ROOT], fake.io);

    expect(listed).toBe(0);
    expect(fake.out()).toContain("stopped");
  });

  it("starts with an empty running record before the first child runs", () => {
    let atStart: unknown[] = [];
    const fake = setup(REGISTER, {
      programs: {
        "fake-sensor": (_args, files) => {
          atStart = [...files.keys()]
            .filter((key) => key.startsWith(`${LOG}/`))
            .map((key) => JSON.parse(files.get(key) as string));

          return undefined;
        },
      },
    });

    run(["scan", ROOT, "--sense", "all"], fake.io);

    expect(atStart).toMatchObject([{ outcome: "running", phases: [] }]);
    expect(saved(fake)).toMatchObject([{ outcome: "failed" }]);
  });
});

describe("scan --sense running a registered sensor as a real process", () => {
  it("writes the sensor's findings file with the commit it was given", () => {
    const root = makeTempDir("recognizer-sensor-");

    cpSync(join(REPO, "fixtures/python/sample"), root, { recursive: true });

    const git = (...args: string[]) =>
      execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });

    git("init", "-q");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "t");
    git("add", ".");
    git("commit", "-q", "-m", "sample");

    const script = join(REPO, "check/test/fixtures/fake-sensor.mjs");

    mkdirSync(join(root, ".recognizer/cache"), { recursive: true });
    writeFileSync(
      join(root, ".recognizer/cache/scan.python.json"),
      cached(git("rev-parse", "HEAD").trim()),
    );
    writeFileSync(
      join(root, ".recognizer/config.yaml"),
      `sensors:\n  fake-sensor:\n    command: ["node", ${JSON.stringify(script)}, "{repository}", "{commit}", "{output}"]\n`,
    );

    const sensed = capture();
    const versionProbe = join(makeTempDir("recognizer-scanner-"), "python.sh");
    const saved = process.env.RECOGNIZER_SCAN_PYTHON;

    writeFileSync(versionProbe, "#!/bin/sh\necho 0.0.0\n");
    chmodSync(versionProbe, 0o755);
    process.env.RECOGNIZER_SCAN_PYTHON = versionProbe;

    try {
      expect(run(["scan", root, "--sense", "all"], sensed.io)).toBe(0);
    } finally {
      if (saved === undefined) {
        delete process.env.RECOGNIZER_SCAN_PYTHON;
      } else {
        process.env.RECOGNIZER_SCAN_PYTHON = saved;
      }
    }

    const out = capture();
    const code = run(["check", "--repository", root, "--json"], out.io);
    const file = join(root, ".recognizer/cache/findings/fake-sensor.json");
    const document = JSON.parse(readFileSync(file, "utf8"));

    expect(sensed.err()).toBe("");
    expect(out.err()).toBe("");
    expect(document.commit).toBe(git("rev-parse", "HEAD").trim());
    expect(JSON.parse(out.out()).violations).toHaveLength(1);
    expect(code).toBe(1);
  });
});

describe("a report in the findings folder", () => {
  const MODULE = "shop/domain/order.py";
  const REVIEW = `${ROOT}/.recognizer/cache/findings/review.json`;
  const OLD = `${ROOT}/.recognizer/cache/findings/old-review.json`;
  const STRAY = `${ROOT}/.recognizer/cache/findings/stray.json`;

  function reportDocument(name: string, commit: string, summary: string) {
    return fakeDocument({
      sensor: { name, version: "reported" },
      commit,
      reported_at: "2026-11-02T10:00:00.000Z",
      findings: [
        {
          id: `${name}:1`,
          kind: "review",
          severity: "warning",
          principle: "p",
          summary,
          evidence: { modules: [MODULE] },
        },
      ],
    });
  }

  function mixed() {
    return setup(null, {
      files: {
        [REVIEW]: reportDocument("review", COMMIT, "current report finding"),
        [OLD]: reportDocument(
          "old-review",
          "def4567890",
          "stale report finding",
        ),
        [STRAY]: fakeDocument({ sensor: { name: "stray", version: "1" } }),
      },
    });
  }

  it("is read by check at the scan's commit and listed ran with reported", () => {
    const fake = setup(null, {
      files: {
        [REVIEW]: reportDocument("review", COMMIT, "current report finding"),
      },
    });
    const { out, err } = check(fake, "--json");
    const report = JSON.parse(out.slice(out.indexOf("{")));

    expect(JSON.stringify(report)).toContain("current report finding");
    expect(report.sensors).toContainEqual({
      name: "review",
      status: "ran",
      reported: true,
    });
    expect(err).not.toContain("review");
    expect(fake.files.has(REVIEW)).toBe(true);
  });

  it("from another commit is ignored, named as reported at its short commit and kept", () => {
    const fake = setup(null, {
      files: {
        [OLD]: reportDocument(
          "old-review",
          "def4567890",
          "stale report finding",
        ),
      },
    });
    const { out, err } = check(fake, "--json");
    const report = JSON.parse(out.slice(out.indexOf("{")));

    expect(err).toContain("stale old-review (reported at def4567)\n");
    expect(JSON.stringify(report)).not.toContain("stale report finding");
    expect(report.sensors).toContainEqual({
      name: "old-review",
      status: "stale",
      reported: true,
    });
    expect(fake.files.has(OLD)).toBe(true);
  });

  it("is not a report when the file is a registered sensor's or carries no mark", () => {
    const fake = mixed();
    const { err } = check(fake, "--json");

    expect(err).toContain("removed unregistered stray\n");
    expect(fake.files.has(STRAY)).toBe(false);
    expect(fake.files.has(REVIEW)).toBe(true);
    expect(fake.files.has(OLD)).toBe(true);
  });

  it("with a current, a stale and a stray file names only the stale one as not current", () => {
    const fake = mixed();
    const { out, err } = check(fake, "--json");

    expect(err).toContain("stale old-review (reported at def4567)");
    expect(err).not.toContain("stale review");
    expect(out).toContain("current report finding");
    expect(out).not.toContain("stale report finding");
  });

  it("is included by show when current and named on stderr when stale", () => {
    const fake = mixed();
    const code = run(["show", MODULE, "--repository", ROOT, "--json"], fake.io);

    expect(code).toBe(0);
    expect(fake.out()).toContain("current report finding");
    expect(fake.out()).not.toContain("stale report finding");
    expect(fake.err()).toContain("stale old-review (reported at def4567)");
    expect(fake.err()).toContain("ignored unregistered stray");
    expect(fake.files.has(STRAY)).toBe(true);
  });
});
