import { describe, expect, it } from "vitest";
import {
  committedScan,
  event,
  Gate,
  type Program,
  sensorProgram,
  typescriptScanner,
} from "../../../cli/test/support/index";
import { OPEN_RUN, type PlannedRun } from "../../src/scan-freshness";
import type { ScanTicks } from "../../src/scan-panel-model";
import { untilHolds } from "../app-harness";
import { inProcessAppRoot } from "../in-process-root";
import {
  afterOpen,
  DESCRIBER_CONFIG,
  describerFailing,
  describerProgram,
  type SensorsScript,
  type SuiteScript,
  sampleFiles,
  sensorsOf,
  settledRun,
  untilTogether,
} from "../rescan-support";

const FRESH = {
  describe: false,
  analysis: true,
  sensors: true,
  ticked: null,
  remembered: false,
};

const SUITE_TICKS = {
  mut: { ticked: ["unit", "web"], known: ["unit", "web"] },
};

const BOTH_SUITES: SuiteScript = [
  { name: "unit", language: "python" },
  { name: "web", language: "typescript" },
];

const TESTING_SENSORS: SensorsScript = {
  mut: { runsTests: true, suites: BOTH_SUITES },
  alpha: {},
};

const stalePlan = async (
  root: Root,
  host: { ticks(): ScanTicks },
  sense: string[],
): Promise<PlannedRun> => {
  const view = await root.service.call("scan.plan", {
    repository: root.repository,
    mode: "rescan",
    ticks: {
      ...host.ticks(),
      ticked: sense,
      armed: ["mut"],
      suites: SUITE_TICKS,
    },
    scope: null,
    changed: [],
  });

  return {
    plan: (view as unknown as { ok: { intent: PlannedRun["plan"] } }).ok.intent,
    dropped: [],
    modules: 0,
    idle: false,
    label: "Run",
    progress: "Running",
    work: {},
  };
};

const lifecycle = /^Scan (started|complete|failed|refused)/;

const failingWith =
  (program: Program, stderr: string): Program =>
  (call) =>
    call.args[0] === "run"
      ? Promise.resolve(program(call)).then((result) => ({
          ...result,
          status: 1,
          stdout: "",
          stderr,
        }))
      : program(call);

type Root = Awaited<ReturnType<typeof inProcessAppRoot>>;

type Mode = { scanner: "ok" | "bad-flag" | "missing" };

const scannerIn = (mode: Mode): Program => {
  const real = typescriptScanner();

  return (call) => {
    if (call.args[0] === "run" && mode.scanner === "bad-flag") {
      return { started: true, status: 2, stdout: "", stderr: "bad flag\n" };
    }

    if (mode.scanner === "missing") {
      return { started: false, status: 127, stdout: "", stderr: "" };
    }

    return real(call);
  };
};

type Begin = Parameters<typeof inProcessAppRoot>[0] & {
  describer?: Program;
  mode?: Mode;
  override?: Record<string, Program>;
};

async function begin(scripts: SensorsScript, options: Begin = {}) {
  const { config, programs } = sensorsOf(scripts);
  const {
    describer,
    mode = { scanner: "ok" },
    override = {},
    ...rest
  } = options;
  const root = await inProcessAppRoot({
    config: (describer === undefined ? "" : DESCRIBER_CONFIG) + config,
    programs: {
      ...programs,
      "recognizer-scan-typescript": scannerIn(mode),
      ...(describer === undefined ? {} : { describer }),
      ...override,
    },
    describing: { model: "m", batchSize: 3, confirmAboveUsd: 0 },
    files: sampleFiles(),
    ticks: FRESH,
    ...rest,
  });
  const opened = await afterOpen(root);
  const host = root.view.explorer()?.host;

  if (host === undefined) {
    throw new Error("no explorer after open");
  }

  return { root, opened, host };
}

const posts = (root: Root) =>
  root.view.tray.posted.filter((one) => !lifecycle.test(one.input.text));

const startExternal = (root: Root, args: Record<string, unknown> = {}) => {
  const other = root.second();

  other.send("scan.start", { repository: root.repository, ...args });

  return other;
};

const postedText = (root: Root, pattern: RegExp) => () =>
  root.view.tray.posted.find((one) => pattern.test(one.input.text))?.input;

const gated = () => {
  const gate = new Gate();

  gate.hold();

  return gate;
};

const walk = async (
  root: Root,
  host: { runState(): { started: string | null } },
  gates: [string, Gate][],
) => {
  for (const [name, gate] of gates) {
    await untilHolds(root.service, () =>
      host.runState().started === name ? true : undefined,
    );
    gate.open();
  }
};

const reaches = <T>(root: Root, find: () => T | undefined) =>
  untilHolds(root.service, find);

const setBaseline = (root: Root, ids: string[]) =>
  root.io.files.writeFile(
    `${root.repository}/.recognizer/baselines/violations.json`,
    JSON.stringify({
      schema_version: 1,
      violations: ids.map((id) => ({ id })),
    }),
  );

const entry = (id: string) => `\u0000id\u0000${id}`;

const baselines = (root: Root) =>
  root.view.explorers.flatMap((one) => one.loads.map((load) => load.baseline));

const loadsReach = (root: Root, count: number) => () =>
  baselines(root).length >= count ? true : undefined;

describe("createRescanner", () => {
  it("shows only the started sensor as running, the rest waiting, and holds a failure until the sensor next finishes ok", async () => {
    const alpha = gated();
    const beta = gated();
    const { root, opened, host } = await begin({
      alpha: { gate: alpha, fails: true },
      beta: { gate: beta },
    });
    const seen: (string | null)[] = [];

    host.run(null);
    await reaches(root, () =>
      host.runState().started === "alpha" ? true : undefined,
    );
    seen.push(host.runState().started);
    alpha.open();
    await reaches(root, () =>
      host.runState().started === "beta" ? true : undefined,
    );
    seen.push(host.runState().started);
    beta.open();
    await settledRun(root, opened);

    expect(seen).toEqual(["alpha", "beta"]);
    expect(Object.keys(host.runState().failures)).toEqual(["alpha"]);
    expect(host.runState().running).toEqual([]);
    expect(host.runState().started).toBeNull();

    const second = await begin({ alpha: {}, beta: {} });

    second.host.run(null);
    await settledRun(second.root, second.opened);

    expect(second.host.runState().failures).toEqual({});
  });

  it("posts no error message for a sensor entry that ended because the user pressed Stop", async () => {
    const gate = gated();
    const { root, opened, host } = await begin({ alpha: { gate } });

    host.run(null);
    await reaches(root, () =>
      host.runState().started === "alpha" ? true : undefined,
    );
    host.stop();
    await settledRun(root, opened);

    expect(host.runView?.().progress.stopped).toBe(true);
    expect(posts(root).filter((one) => one.input.kind === "error")).toEqual([]);
  });

  it("builds the plan from the remembered ticks and remembers a repository's first ticks", async () => {
    const { root, opened, host } = await begin(
      { alpha: {}, beta: {} },
      {
        describer: describerProgram(),
        ticks: { ...FRESH, describe: true },
      },
    );

    host.run(null);
    await settledRun(root, opened);

    expect(root.service.started.slice(opened)).toMatchObject([
      { describe: "stale", analysis: true, sense: ["alpha", "beta"] },
    ]);
    expect(root.service.started[opened]?.modules ?? null).toBeNull();
    expect(root.ticksWritten).toMatchObject([
      { describe: true, analysis: true },
    ]);
    expect(root.ticksWritten[0]?.ticked).toEqual(
      expect.arrayContaining(["alpha", "beta"]),
    );

    const written = root.ticksWritten.length;

    host.run(null);
    await settledRun(root, opened + 1);

    expect(root.ticksWritten).toHaveLength(written);
  });

  it("runs only the structure scan on open and leaves the remembered ticks alone", async () => {
    const { root, opened, host } = await begin(
      { alpha: {}, beta: {} },
      { describer: describerProgram(), ticks: { ...FRESH, describe: true } },
    );

    host.run(null);
    await settledRun(root, opened);

    const written = [...root.ticksWritten];
    const before = host.ticks();

    host.run(null, OPEN_RUN);
    await settledRun(root, opened + 1);

    expect(root.service.started[opened + 1]).toMatchObject({
      describe: false,
      analysis: true,
      sense: [],
    });
    expect(root.service.started[opened + 1]?.modules ?? null).toBeNull();
    expect(root.ticksWritten).toEqual(written);
    expect(host.ticks()).toEqual(before);
    expect(before.describe).toBe(true);
  });

  it("clears a sensor's diagnosis when a later run finishes it ok", async () => {
    const mode = { refused: true };
    const hold = gated();
    const refused = sensorProgram("alpha", {
      before: [
        event({
          event: "diagnosis",
          code: "tool-missing",
          text: "cargo-llvm-cov is missing",
        }),
      ],
      after: [],
      fails: true,
      gate: hold,
    });
    const second = gated();
    const ok = sensorProgram("alpha", { gate: second });
    const beta = gated();
    const { config, programs } = sensorsOf({ alpha: {}, beta: { gate: beta } });
    const { root, opened, host } = await begin(
      { alpha: {}, beta: { gate: beta } },
      {
        config,
        programs: {
          ...programs,
          "recognizer-sense-alpha": (call) =>
            call.args[0] === "run" && mode.refused ? refused(call) : ok(call),
        },
      },
    );

    host.run(null);
    await walk(root, host, [
      ["alpha", hold],
      ["beta", beta],
    ]);
    await settledRun(root, opened);

    expect(host.runState().diagnoses).toMatchObject({
      alpha: { code: "tool-missing" },
    });

    mode.refused = false;
    beta.hold();
    host.run(null);
    await walk(root, host, [
      ["alpha", second],
      ["beta", beta],
    ]);
    await settledRun(root, opened + 1);

    expect(host.runState().diagnoses).toEqual({});
    expect(host.runState().failures).toEqual({});
  });

  it("posts exactly one tray message for a failed sensor entry, not one per refresh", async () => {
    const alpha = gated();
    const beta = gated();
    const { root, opened, host } = await begin({
      alpha: { gate: alpha, fails: true },
      beta: { gate: beta },
    });

    host.run(null);
    await walk(root, host, [
      ["alpha", alpha],
      ["beta", beta],
    ]);
    await settledRun(root, opened);
    host.refresh();
    await root.service.signal(50);

    expect(
      posts(root).filter((one) => one.input.kind === "error"),
    ).toHaveLength(1);
    expect(posts(root)[0]?.input.text).toMatch(/^alpha failed: /);
  });

  it("runs Descriptions as running while the describe phase is open and waiting before it", async () => {
    const hold = gated();
    const gate = gated();
    const beta = gated();
    const { root, opened, host } = await begin(
      { alpha: { gate }, beta: { gate: beta } },
      {
        describer: describerProgram(hold),
        ticks: { ...FRESH, describe: true },
      },
    );
    const seen: { running: string[]; started: string | null }[] = [];

    host.run(null);
    await reaches(root, () =>
      host.runState().started === "describe" ? true : undefined,
    );
    seen.push({
      running: host.runState().running,
      started: host.runState().started,
    });
    hold.open();
    await reaches(root, () =>
      host.runState().started === "alpha" ? true : undefined,
    );
    seen.push({
      running: host.runState().running,
      started: host.runState().started,
    });
    gate.open();
    beta.open();
    await settledRun(root, opened);

    expect(seen[0]).toEqual({
      running: ["describe", "alpha", "beta"],
      started: "describe",
    });
    expect(seen[1]?.running).not.toContain("describe");
    expect(seen[1]?.started).toBe("alpha");
  });

  it("says Stopped, keeps what was written and settles after a stop", async () => {
    const gate = gated();
    const { root, opened, host } = await begin(
      { alpha: { gate } },
      { describer: describerProgram(), ticks: { ...FRESH, describe: true } },
    );
    const loads = root.view.explorer()?.loads.length ?? 0;

    host.run(null);
    await reaches(root, () =>
      host.runState().started === "describe" ||
      host.runState().started === "alpha"
        ? true
        : undefined,
    );
    host.stop();
    await settledRun(root, opened);

    expect(root.view.progress.at(-1)).toBeNull();
    expect(host.running()).toBe(false);
    expect(root.view.explorer()?.loads.length ?? 0).toBeGreaterThanOrEqual(
      loads,
    );
  });

  describe("opening from the cache when the scan fails", () => {
    const cachedScan = (over: Record<string, unknown> = {}) => ({
      ".recognizer/cache/scan.typescript.json": JSON.stringify({
        ...committedScan(),
        ...over,
      }),
    });

    const failingOpen = async (files: Record<string, string>) => {
      const order: string[] = [];
      const { config, programs } = sensorsOf({ alpha: {} });
      const root = await inProcessAppRoot({
        config,
        programs,
        failing: ["scan.start"],
        files: { ...sampleFiles(), ...files },
        ticks: FRESH,
      });
      const { footer, explorers } = root.view;
      const post = footer.post.bind(footer);
      const push = explorers.push.bind(explorers);

      footer.post = (input) => {
        order.push(`post:${input.text}`);

        return post(input);
      };
      explorers.push = (...items) => {
        order.push("explorer");

        return push(...items);
      };

      await reaches(root, () =>
        root.view.explorer() !== null ||
        root.view.messages.some((one) => one.isError)
          ? true
          : undefined,
      );
      await root.service.signal(500);

      return { root, order };
    };

    it("builds the explorer from the cache before reporting the failure", async () => {
      const { root, order } = await failingOpen(cachedScan());

      expect(root.view.explorer()).not.toBeNull();

      const at = [
        order.indexOf("explorer"),
        order.findIndex((one) =>
          /^post:The recognizer scan exited.*scan\.start failed/.test(one),
        ),
      ];

      expect(at.every((index) => index >= 0)).toBe(true);
      expect(at).toEqual([...at].sort((a, b) => a - b));
    });

    it("blocks with no explorer when nothing is cached", async () => {
      const { root } = await failingOpen({});

      expect(root.view.explorer()).toBeNull();
      expect(
        root.view.messages.some((one) => /scan\.start failed/.test(one.text)),
      ).toBe(true);
    });

    it("blocks when the viewer refuses the cache", async () => {
      const { root } = await failingOpen(cachedScan({ schema_version: 9 }));

      expect(root.view.explorer()).toBeNull();
      expect(
        root.view.messages.some((one) => /scan\.start failed/.test(one.text)),
      ).toBe(true);
    });

    it("leaves an open explorer alone", async () => {
      const failing: string[] = [];
      const { root, opened, host } = await begin(
        { alpha: {} },
        { failing, files: { ...sampleFiles(), ...cachedScan() } },
      );
      const explorers = root.view.explorers.length;
      const loads = root.view.explorer()?.loads.length ?? 0;

      failing.push("scan.start");
      host.run(null, OPEN_RUN);
      await root.service.signal(500);

      expect(
        root.view.tray.posted.some((one) =>
          /scan\.start failed/.test(one.input.text),
        ),
      ).toBe(true);
      expect(root.view.explorers.length).toBe(explorers);
      expect(root.view.explorer()?.loads.length).toBe(loads);
      expect(opened).toBeGreaterThan(0);
    });
  });

  it("keeps the old explorer when adopting fails", async () => {
    const failing: string[] = [];
    const { root, opened, host } = await begin({ alpha: {} }, { failing });
    const explorers = root.view.explorers.length;

    failing.push("adopt_scan");
    host.run(null);
    await settledRun(root, opened);
    await root.service.signal(500);

    expect(root.view.explorers.length).toBe(explorers);
    expect(
      root.view.tray.posted.some((one) =>
        /adopt_scan failed/.test(one.input.text),
      ),
    ).toBe(true);
  });

  it("refreshes the sensors without scanning, carrying the state", async () => {
    const { root, opened, host } = await begin({ alpha: {} });
    const explorers = root.view.explorers.length;

    setBaseline(root, ["p0"]);
    host.refresh();
    await reaches(root, loadsReach(root, 2));

    expect(root.service.started.length).toBe(opened);
    expect(root.view.explorers.length).toBe(explorers);
    expect(baselines(root)).toEqual([null, [entry("p0")]]);
  });

  it("replaces once and skips a refresh whose sensed data equals the last replaced", async () => {
    const { root, host } = await begin({ alpha: {} });

    for (let turn = 0; turn < 5; turn++) {
      host.refresh();
      await root.service.signal(100);
    }

    expect(root.view.explorers.length).toBe(1);
    expect(root.view.explorer()?.loads).toHaveLength(1);
    expect(root.view.explorer()?.carries).toBe(0);
  });

  it("replaces again when a refresh senses changed data", async () => {
    const { root, host } = await begin({ alpha: {} });

    setBaseline(root, ["p0"]);
    host.refresh();
    await reaches(root, loadsReach(root, 2));
    setBaseline(root, ["p1"]);
    host.refresh();
    await reaches(root, loadsReach(root, 3));

    expect(baselines(root)).toEqual([null, [entry("p0")], [entry("p1")]]);
  });

  it("compares a refresh with the data a scan run replaced", async () => {
    const { root, opened, host } = await begin({ alpha: {} });

    host.run(null);
    await settledRun(root, opened);
    await root.service.signal(200);

    const loads = root.view.explorers.flatMap((one) => one.loads).length;

    host.refresh();
    await root.service.signal(200);

    expect(root.view.explorers.flatMap((one) => one.loads)).toHaveLength(loads);
  });

  it("updates in place when only sensor results change, never replacing after the first scan", async () => {
    const { root, host } = await begin({ alpha: {} });

    for (const [turn, ids] of [["p0"], ["p1"], ["p2"]].entries()) {
      setBaseline(root, ids);
      host.refresh();
      await reaches(root, loadsReach(root, turn + 2));
    }

    expect(root.view.explorers.length).toBe(1);
    expect(root.view.explorer()?.carries).toBe(0);
    expect(baselines(root)).toEqual([
      null,
      [entry("p0")],
      [entry("p1")],
      [entry("p2")],
    ]);
  });

  it("updates in place from a sensor-only scan run after the first scan", async () => {
    const { root, opened, host } = await begin({ alpha: {} });

    host.run(null);
    await settledRun(root, opened);
    await root.service.signal(200);

    expect(root.view.explorers.length).toBe(1);
    expect(root.view.explorer()?.carries).toBe(0);
    expect(root.view.explorer()?.loads.length).toBeGreaterThan(1);
  });

  it("replaces with the carried value when the loaded structure changes", async () => {
    const { root, opened, host } = await begin({ alpha: {} });

    root.io.files.writeFile(
      `${root.repository}/api/src/extra.ts`,
      "export const extra = 1;\n",
    );
    host.run(null);
    await settledRun(root, opened);
    await reaches(root, () =>
      root.view.explorers.length === 2 ? true : undefined,
    );

    expect(root.view.explorers[0]?.carries).toBe(1);
    expect(root.view.explorers[1]?.carries).toBe(0);
  });

  it("falls back to replace when update returns false", async () => {
    const { root } = await begin({ alpha: {} });

    root.assignFolder();
    await reaches(root, () =>
      root.view.explorers.length === 2 ? true : undefined,
    );

    expect(root.view.explorers[0]?.carries).toBe(0);
    expect(root.view.explorers[1]?.carries).toBe(0);
    expect(root.view.explorers[1]?.loads).toHaveLength(1);
  });

  it("builds one explorer, loaded once and carrying nothing, from the open scan", async () => {
    const { root } = await begin({ alpha: {} });

    expect(root.view.explorers.length).toBe(1);
    expect(root.view.explorer()?.loads).toHaveLength(1);
    expect(root.view.explorer()?.carries).toBe(0);
  });

  it("refreshes nothing when there is nothing loaded", async () => {
    const { config, programs } = sensorsOf({ alpha: {} });
    const root = await inProcessAppRoot({
      config,
      programs,
      files: sampleFiles(),
      ticks: FRESH,
      folderKnown: false,
    });

    await root.service.signal(1000);
    setBaseline(root, ["p0"]);
    await root.service.signal(1000);

    expect(root.view.explorers).toHaveLength(0);
  });

  it("does not present a refresh as running and starts no scan or sensor run", async () => {
    const hold = new Gate();
    const { root, opened, host } = await begin(
      { alpha: {} },
      { holds: { "inputs.read": hold } },
    );

    hold.hold();
    setBaseline(root, ["p0"]);
    host.refresh();
    await root.service.signal(100);

    expect(host.running()).toBe(false);
    expect(host.external?.()).toBe(false);
    hold.open();
    await reaches(root, loadsReach(root, 2));

    expect(host.running()).toBe(false);
    expect(root.service.started.length).toBe(opened);
  });

  it("a_refresh_is_a_render_of_the_newest_revision", async () => {
    const hold = new Gate();
    const { root, host } = await begin(
      { alpha: {} },
      { holds: { "inputs.read": hold } },
    );

    hold.hold();
    setBaseline(root, ["revision-1"]);
    host.refresh();
    await root.service.signal(100);
    setBaseline(root, ["revision-2"]);
    host.refresh();
    await root.service.signal(100);
    hold.open();
    await reaches(root, () =>
      baselines(root).at(-1)?.[0] === entry("revision-2") ? true : undefined,
    );

    expect(baselines(root).at(-1)).toEqual([entry("revision-2")]);
  });

  it("renders a refresh during a run from the newest revision, deferring nothing", async () => {
    const hold = new Gate();
    const { root, opened, host } = await begin({ alpha: { gate: hold } });

    hold.hold();
    host.run(null);
    await reaches(root, () =>
      host.runState().started === "alpha" ? true : undefined,
    );
    setBaseline(root, ["during"]);
    host.refresh();
    await reaches(root, () =>
      baselines(root).some((one) => one?.[0] === entry("during"))
        ? true
        : undefined,
    );
    hold.open();
    await settledRun(root, opened);

    expect(baselines(root).some((one) => one?.[0] === entry("during"))).toBe(
      true,
    );
  });

  it("does not read again after a scan when no input changed while it ran", async () => {
    const { root, opened, host } = await begin({ alpha: {}, beta: {} });

    host.run(null);
    await settledRun(root, opened);

    const after = root.view.explorer()?.loads.length ?? 0;

    await root.service.signal(50);

    expect(root.view.explorer()?.loads.length ?? 0).toBe(after);
  });

  it("writes a test-running sensor's tick with the others and keeps it after every Scan however it ends", async () => {
    for (const ending of ["ok", "bad-flag"] as const) {
      const mode: Mode = { scanner: "ok" };
      const { root, opened, host } = await begin(TESTING_SENSORS, { mode });

      host.setTicks({
        ...host.ticks(),
        armed: ["mut"],
        onlyView: false,
        suites: SUITE_TICKS,
        folds: ["mut"],
      });
      await root.service.signal(10);

      expect(Object.keys(host.ticks().suites)).not.toEqual([]);
      expect(host.ticks().folds).not.toEqual([]);

      mode.scanner = ending;
      host.run(null);
      await settledRun(root, opened);

      expect(root.service.started[opened]?.sense).toContain("mut");
      expect(root.ticksWritten.at(-1)?.ticked).toContain("mut");
      expect(host.ticks().armed).toEqual(["mut"]);
      expect(host.ticks().suites).toEqual(SUITE_TICKS);
      expect(host.ticks().folds).toEqual(["mut"]);
      expect(root.ticksWritten.at(-1)?.suites).toEqual(SUITE_TICKS);
      expect(root.ticksWritten.at(-1)?.folds).toEqual(["mut"]);
    }
  });

  it("hands the port a stale plan's test-running sensor that is armed", async () => {
    const { root, opened, host } = await begin(TESTING_SENSORS);
    const stale = await stalePlan(root, host, ["mut"]);

    host.setTicks({ ...host.ticks(), armed: ["mut"], suites: SUITE_TICKS });
    await root.service.signal(10);
    host.run(null, stale);
    await settledRun(root, opened);

    expect(root.service.started[opened]?.sense).toEqual(["mut"]);
  });

  it("does not hand the port a stale plan's test-running sensor that is not armed", async () => {
    const { root, opened, host } = await begin(TESTING_SENSORS);
    const stale = await stalePlan(root, host, ["mut", "alpha"]);

    host.setTicks({ ...host.ticks(), armed: [], suites: SUITE_TICKS });
    await root.service.signal(10);

    expect(stale.plan.sense).toContain("mut");

    host.run(null, stale);
    await settledRun(root, opened);

    expect(root.service.started[opened]?.sense).toEqual(["alpha"]);
    expect(root.service.started[opened]?.suites).toEqual({});
  });

  it("keeps both sensors' armed entries and suite ticks after a Scan", async () => {
    const { root, opened, host } = await begin({
      crap: { runsTests: true, suites: BOTH_SUITES },
      mut: {
        runsTests: true,
        suites: [{ name: "unit", language: "python" }],
      },
    });
    const suites = {
      crap: { ticked: ["unit", "web"], known: ["unit", "web"] },
      mut: { ticked: ["unit"], known: ["unit"] },
    };

    host.setTicks({
      ...host.ticks(),
      armed: ["crap"],
      suites,
      folds: ["crap", "mut"],
    });
    await root.service.signal(10);

    expect(Object.keys(host.ticks().suites)).toEqual(["crap", "mut"]);

    host.run(null);
    await settledRun(root, opened);

    expect(root.service.started[opened]?.sense).toEqual(["crap"]);
    expect(root.service.started[opened]?.suites).toEqual({
      crap: ["unit", "web"],
    });
    expect(host.ticks().armed).toEqual(["crap"]);
    expect(host.ticks().suites).toEqual(suites);
    expect(host.ticks().folds).toEqual(["crap", "mut"]);
  });

  it("re-reads the sensor findings after a stopped Scan", async () => {
    const gate = gated();
    const { root, opened, host } = await begin({ alpha: { gate } });
    const loads = root.view.explorer()?.loads.length ?? 0;

    host.run(null);
    await reaches(root, () =>
      host.runState().started === "alpha" ? true : undefined,
    );
    host.stop();
    await settledRun(root, opened);

    expect(root.view.explorer()?.loads.length ?? 0).toBeGreaterThan(loads);
  });

  it("keeps the ticks as set when the Scan fails or is stopped", async () => {
    for (const ending of ["bad-flag", "stopped"] as const) {
      const mode: Mode = { scanner: "ok" };
      const gate = gated();
      const { root, opened, host } = await begin(
        { ...TESTING_SENSORS, alpha: { gate } },
        { mode },
      );

      host.setTicks({
        ...host.ticks(),
        armed: ["mut"],
        onlyView: false,
        suites: SUITE_TICKS,
        folds: ["mut"],
      });
      await root.service.signal(10);

      expect(Object.keys(host.ticks().suites)).not.toEqual([]);

      if (ending === "bad-flag") {
        mode.scanner = ending;
        gate.open();
        host.run(null);
      } else {
        host.run(null);
        await reaches(root, () =>
          host.runState().started === "alpha" ? true : undefined,
        );
        host.stop();
      }

      await settledRun(root, opened);

      expect(host.ticks().armed).toEqual(["mut"]);
      expect(host.ticks().suites).toEqual(SUITE_TICKS);
      expect(host.ticks().folds).toEqual(["mut"]);
    }
  });

  describe("unregistered plugins", () => {
    it("keeps a remembered tick for an unregistered sensor and describe out of the plan", async () => {
      const { root, opened, host } = await begin(
        { alpha: {} },
        { ticks: { ...FRESH, describe: true } },
      );

      expect(host.ticks().describe).toBe(true);
      expect(host.ticks().ticked).toBeNull();

      host.setTicks({ ...host.ticks(), ticked: ["alpha", "beta"] });
      await root.service.signal(10);
      host.run(null);
      await settledRun(root, opened);

      expect(host.ticks().ticked).toEqual(["alpha", "beta"]);
      expect(root.service.started[opened]?.sense).toEqual(["alpha"]);
      expect(root.service.started[opened]?.describe).toBe(false);
    });
  });

  it("sends the file scope in the plan and remembers the switch", async () => {
    const scope = Object.keys(sampleFiles())
      .filter((path) => path.endsWith(".ts"))
      .slice(0, 2);
    const { root, opened, host } = await begin(
      { alpha: {}, beta: {} },
      { describer: describerProgram(), ticks: { ...FRESH, describe: true } },
    );

    host.setTicks({ ...host.ticks(), onlyView: true });
    await root.service.signal(10);
    host.run(scope);
    await settledRun(root, opened);

    expect(root.ticksWritten.at(-1)?.onlyView).toBe(true);
    expect(root.service.started[opened]?.modules).toEqual(scope);
  });

  it("sends no scope when none is given or nothing but extraction would run", async () => {
    const { root, opened, host } = await begin(
      { alpha: {} },
      { ticks: { ...FRESH, sensors: false, ticked: [] } },
    );

    host.run(null);
    await settledRun(root, opened);
    host.run(["a.ts"]);
    await settledRun(root, opened + 1);

    expect(
      root.service.started.slice(opened).map((plan) => plan.modules ?? null),
    ).toEqual([null, null]);
  });

  it("reads the remembered switch back from the port", async () => {
    const first = await begin({ alpha: {} });

    first.host.setTicks({ ...first.host.ticks(), onlyView: true });
    await first.root.service.signal(10);

    const written = first.root.ticksWritten.at(-1);
    const again = await begin(
      { alpha: {} },
      { ticks: { ...FRESH, ...written } },
    );

    expect(written?.onlyView).toBe(true);
    expect(again.host.ticks().onlyView).toBe(true);
  });

  it("writes the ticks through the port when they change", async () => {
    const { root, host } = await begin({ alpha: {}, beta: {} });
    const before = root.ticksWritten.length;
    const next = {
      describe: true,
      analysis: true,
      ticked: null,
      armed: [],
      onlyView: false,
      suites: {},
      folds: [],
    };

    host.setTicks(next);
    await root.service.signal(10);

    expect(root.ticksWritten.slice(before)).toEqual([
      {
        describe: true,
        analysis: true,
        ticked: ["alpha", "beta", "crap"],
        onlyView: false,
        suites: {},
        folds: [],
      },
    ]);
    expect(host.ticks()).toEqual(next);
  });

  it("posts a failed sensor as an error whose Show reaches the sensor row", async () => {
    const alpha = gated();
    const beta = gated();
    const { programs } = sensorsOf({ alpha: { gate: alpha } });
    const { root, opened, host } = await begin(
      { alpha: { gate: alpha }, beta: { gate: beta } },
      {
        override: {
          "recognizer-sense-alpha": failingWith(
            programs["recognizer-sense-alpha"] as Program,
            "boom",
          ),
        },
      },
    );

    host.run(null);
    await walk(root, host, [
      ["alpha", alpha],
      ["beta", beta],
    ]);
    await settledRun(root, opened);
    await root.service.signal(500);

    const failure = posts(root).find((one) =>
      one.input.text.startsWith("alpha"),
    )?.input;

    expect(failure).toMatchObject({
      kind: "error",
      text: "alpha failed: boom",
    });
    expect(failure?.key).toBeUndefined();
    expect(failure?.action?.label).toBe("Show");

    failure?.action?.run();

    expect(root.view.explorer()?.shown.map((one) => one.kind)).toContain(
      "sensor",
    );
  });

  describe("the describe result of a scan the command line started", () => {
    const outcomeOf = async (
      reasons: Record<string, string> | null,
      modules: string[],
      describe: boolean,
    ) => {
      const gate = gated();
      const { root } = await begin(
        { alpha: { gate } },
        {
          describer:
            reasons === null ? describerProgram() : describerFailing(reasons),
          ticks: { ...FRESH, describe },
        },
      );
      const other = startExternal(root, {
        describe: describe ? "stale" : false,
        sense: ["alpha"],
        ...(modules.length === 0 ? {} : { modules }),
      });

      await untilTogether(root, other, postedText(root, /^Scan started/));
      gate.open();
      await untilTogether(
        root,
        other,
        postedText(root, /^Scan (complete|failed)/),
      );
      await root.service.signal(500);

      return root;
    };

    it("posts the describe result as info with no action when nothing failed", async () => {
      const root = await outcomeOf(
        null,
        ["api/src/place.ts", "api/src/types.ts"],
        true,
      );

      expect(posts(root).at(-1)?.input).toEqual({
        kind: "info",
        text: "Describe wrote 2 lines, 0 files failed.",
      });
    });

    it("posts the describe result with Show on the first failed file", async () => {
      const root = await outcomeOf(
        {
          "api/src/place.ts": "x",
          "api/src/types.ts": "y",
          "web/src/main.tsx": "z",
        },
        [
          "api/src/index.ts",
          "api/src/place.ts",
          "api/src/types.ts",
          "web/src/main.tsx",
        ],
        true,
      );
      const result = posts(root).find((one) =>
        one.input.text.startsWith("Describe"),
      )?.input;

      expect(result?.text).toBe("Describe wrote 1 lines, 3 files failed.");
      expect(result?.action?.label).toBe("Show");

      result?.action?.run();

      expect(root.view.explorer()?.shown.map((one) => one.kind)).toContain(
        "module",
      );
    });

    it("posts nothing about describe when no describe phase ran", async () => {
      const root = await outcomeOf(null, [], false);

      expect(
        posts(root).some((one) => one.input.text.startsWith("Describe")),
      ).toBe(false);
    });
  });

  describe("the describe confirmation", () => {
    const asking = async () => {
      const answers: unknown[] = [];
      const gate = gated();
      const { root, host } = await begin(
        { alpha: { gate } },
        {
          describer: describerProgram(),
          ticks: { ...FRESH, describe: true },
          record: (command, args) => {
            if (command === "core_call" && args.op === "confirm.answer") {
              answers.push((args.args as { describe: unknown }).describe);
            }
          },
        },
      );
      const other = startExternal(root, {
        describe: "stale",
        sense: ["alpha"],
        confirmAbove: 0,
      });

      await untilTogether(root, other, () =>
        host.describeAsk() === null ? undefined : true,
      );

      return { root, host, other, answers, gate };
    };

    const cleared = (host: { describeAsk(): unknown }) => () =>
      host.describeAsk() === null ? true : undefined;

    const finished = (
      root: Root,
      other: { advance(ms: number): Promise<void> },
      gate: Gate,
    ) => {
      gate.open();

      return untilTogether(
        root,
        other,
        postedText(root, /^Scan (complete|failed)/),
      );
    };

    it("opens the ask from the record's confirm line and answers describe through the port once", async () => {
      const { root, host, other, answers, gate } = await asking();

      expect(root.view.progress.at(-1)).toContain("Waiting for your answer");

      host.answerDescribe(true);
      await root.service.signal(50);

      expect(answers).toEqual([true]);
      expect(host.describeAsk()).not.toBeNull();

      await untilTogether(root, other, cleared(host));
      host.answerDescribe(true);
      await root.service.signal(50);

      expect(answers).toEqual([true]);
      expect(host.describeAsk()).toBeNull();
      expect(host.describeSkipped()).toBe(false);

      await finished(root, other, gate);
    });

    it("marks the describe phase skipped when the answered line says skip", async () => {
      const { root, host, other, answers, gate } = await asking();

      host.answerDescribe(false);
      await untilTogether(root, other, cleared(host));

      expect(answers).toEqual([false]);
      expect(host.describeAsk()).toBeNull();
      expect(host.describeSkipped()).toBe(true);

      await finished(root, other, gate);
    });

    it("answers a scan the command line started through the same port call", async () => {
      const { root, host, other, answers, gate } = await asking();

      expect(host.describeAsk()).not.toBeNull();

      host.answerDescribe(true);
      await untilTogether(root, other, cleared(host));

      expect(answers).toEqual([true]);
      expect(host.describeAsk()).toBeNull();

      await finished(root, other, gate);
    });

    it("posts an error when the port refuses the answer", async () => {
      const { root, host, other } = await asking();

      other.send("scan.stop", { repository: root.repository });
      await other.advance(1000);
      host.answerDescribe(true);
      await reaches(root, postedText(root, /^Error/));

      expect(posts(root).at(-1)?.input).toMatchObject({
        kind: "error",
        text: "Error: no scan is waiting for an answer",
      });
    });

    it("clears the ask when the scan is stopped while it is open", async () => {
      const { root, host, other } = await asking();

      other.send("scan.stop", { repository: root.repository });
      await untilTogether(root, other, cleared(host));

      expect(host.describeAsk()).toBeNull();
    });
  });

  describe("scan notifications", () => {
    const lifecycleOf = (root: Root) =>
      root.view.tray.posted
        .map((one) => one.input)
        .filter((input) => lifecycle.test(input.text));

    const gapped =
      (program: Program, line: string): Program =>
      (call) =>
        call.args[0] === "check"
          ? {
              started: true,
              status: 0,
              stdout: JSON.stringify({
                gaps: [{ code: "environment", suite: null, line }],
              }),
              stderr: "",
            }
          : program(call);

    const timed = async (seconds: number, describe: boolean) => {
      const gate = gated();
      const { root } = await begin(
        { alpha: { gate }, beta: {} },
        {
          describer: describerProgram(),
          ticks: { ...FRESH, describe },
        },
      );
      const other = startExternal(root, {
        describe: describe ? "stale" : false,
        sense: ["alpha", "beta"],
      });

      await untilTogether(root, other, postedText(root, /^Scan started/));
      await other.advance(seconds * 1000 - 500);
      gate.open();
      await untilTogether(root, other, postedText(root, /^Scan complete/));

      return root;
    };

    it("posts Scan started naming the sensors, and Scan complete with its duration from the record", async () => {
      const root = await timed(192, true);

      expect(lifecycleOf(root)).toEqual([
        { kind: "info", text: "Scan started - Alpha, Beta, describe" },
        { kind: "done", text: "Scan complete - 3m 12s" },
      ]);
    });

    it("reads seconds alone under a minute", async () => {
      const root = await timed(45, false);

      expect(lifecycleOf(root).at(-1)).toEqual({
        kind: "done",
        text: "Scan complete - 45s",
      });
    });

    it("posts the failure with its reason and no Scan complete", async () => {
      const rejects: Record<string, string> = {};
      const { root, host } = await begin({ alpha: {} }, { rejects });

      rejects["scan.start"] = "boom";
      host.run(null);
      await reaches(root, postedText(root, /^Scan failed/));

      expect(lifecycleOf(root).map((one) => one.text)).toEqual([
        "Scan failed - boom",
      ]);
    });

    it("posts a failed run that finished with exit 1 as Scan failed with the first failed entry", async () => {
      const gate = gated();
      const { programs } = sensorsOf({ alpha: { gate } });
      const { root } = await begin(
        { alpha: { gate } },
        {
          override: {
            "recognizer-sense-alpha": failingWith(
              programs["recognizer-sense-alpha"] as Program,
              "no coverage",
            ),
          },
        },
      );
      const other = startExternal(root, { sense: ["alpha"] });

      await untilTogether(root, other, postedText(root, /^Scan started/));
      gate.open();
      await untilTogether(root, other, postedText(root, /^Scan failed/));

      expect(lifecycleOf(root).at(-1)).toEqual({
        kind: "error",
        text: "Scan failed - alpha: no coverage",
      });
    });

    it("posts a warning for a gaps result and never Scan complete", async () => {
      const { programs } = sensorsOf({ alpha: {}, beta: {} });
      const { root, host } = await begin(
        { alpha: {}, beta: {} },
        {
          override: {
            "recognizer-sense-alpha": gapped(
              programs["recognizer-sense-alpha"] as Program,
              "coverage and pytest are not installed",
            ),
            "recognizer-sense-beta": gapped(
              programs["recognizer-sense-beta"] as Program,
              "cargo-llvm-cov is not installed",
            ),
          },
        },
      );

      host.run(null);
      await reaches(root, postedText(root, /^Scan refused/));

      expect(lifecycleOf(root).at(-1)).toEqual({
        kind: "warning",
        text: "Scan refused - 2 problems: coverage and pytest are not installed",
      });
      expect(
        lifecycleOf(root).some((one) => one.text.startsWith("Scan complete")),
      ).toBe(false);
    });

    it("posts a config gap as a problem, not a missing tool", async () => {
      const { programs } = sensorsOf({ alpha: {} });
      const { root, host } = await begin(
        { alpha: {} },
        {
          override: {
            "recognizer-sense-alpha": gapped(
              programs["recognizer-sense-alpha"] as Program,
              "no test suites are configured in .recognizer/config.yaml",
            ),
          },
        },
      );

      host.run(null);
      await reaches(root, postedText(root, /^Scan refused/));

      expect(lifecycleOf(root).at(-1)).toEqual({
        kind: "warning",
        text: "Scan refused - 1 problem: no test suites are configured in .recognizer/config.yaml",
      });
    });

    it("posts a refusal for the live marker as a warning", async () => {
      const gate = gated();
      const { root, host } = await begin(
        { alpha: { gate }, beta: {} },
        {
          override: {
            env: () => ({
              started: true,
              status: 0,
              stdout: "Mon Jan  1 00:00:00 2099\n",
              stderr: "",
            }),
          },
        },
      );
      const other = startExternal(root, { describe: false, sense: ["alpha"] });

      await other.advance(300);
      host.run(null);
      await untilTogether(root, other, postedText(root, /^Scan refused/));

      expect(lifecycleOf(root).at(-1)).toEqual({
        kind: "warning",
        text: `Scan refused - a scan is already running on ${root.repository}`,
      });

      gate.open();
    });
  });
});
