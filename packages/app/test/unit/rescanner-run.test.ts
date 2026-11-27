import { describe, expect, it } from "vitest";
import { Gate } from "../../../cli/test/support/index";
import { untilHolds } from "../app-harness";
import { inProcessAppRoot } from "../in-process-root";
import {
  afterOpen,
  type SensorsScript,
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

async function begin(
  scripts: SensorsScript,
  options: Parameters<typeof inProcessAppRoot>[0] = {},
) {
  const { config, programs } = sensorsOf(scripts);
  const root = await inProcessAppRoot({
    config,
    programs,
    ticks: FRESH,
    ...options,
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
});
