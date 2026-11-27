import { describe, expect, it } from "vitest";
import {
  committedScan,
  event,
  Gate,
  type Program,
  sensorProgram,
  typescriptScanner,
} from "../../../cli/test/support/index";
import { OPEN_RUN } from "../../src/scan-freshness";
import { untilHolds } from "../app-harness";
import { inProcessAppRoot } from "../in-process-root";
import {
  afterOpen,
  DESCRIBER_CONFIG,
  describerProgram,
  type SensorsScript,
  sampleFiles,
  sensorsOf,
  settledRun,
} from "../rescan-support";

const FRESH = {
  describe: false,
  analysis: true,
  sensors: true,
  ticked: null,
  remembered: false,
};

const lifecycle = /^Scan (started|complete|failed|refused)/;

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
};

async function begin(scripts: SensorsScript, options: Begin = {}) {
  const { config, programs } = sensorsOf(scripts);
  const { describer, mode = { scanner: "ok" }, ...rest } = options;
  const root = await inProcessAppRoot({
    config: (describer === undefined ? "" : DESCRIBER_CONFIG) + config,
    programs: {
      ...programs,
      "recognizer-scan-typescript": scannerIn(mode),
      ...(describer === undefined ? {} : { describer }),
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
});
