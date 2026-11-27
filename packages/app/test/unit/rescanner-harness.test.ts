import { describe, expect, it } from "vitest";
import { untilHolds } from "../app-harness";
import { inProcessAppRoot } from "../in-process-root";
import { afterOpen, sensorsOf, settledRun } from "../rescan-support";

const FRESH = {
  describe: false,
  analysis: true,
  sensors: true,
  ticked: null,
  remembered: false,
};

async function open(options: Parameters<typeof inProcessAppRoot>[0] = {}) {
  const { config, programs } = sensorsOf({ alpha: {} });
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

const records = (root: Awaited<ReturnType<typeof inProcessAppRoot>>) =>
  root.io.files
    .list(`${root.repository}/.recognizer/cache/log`)
    .map((path: string) =>
      JSON.parse(root.io.files.readBytes(path).toString()),
    );

describe("rescanner harness seams", () => {
  it("answers a refresh after a file edit through the service", async () => {
    const { root, host } = await open();
    const before = root.lines.length;

    root.io.files.writeFile(
      `${root.repository}/api/src/b.ts`,
      "export const b = 2;\n",
    );
    host.refresh();
    await untilHolds(root.service, () =>
      root.lines.length > before ? true : undefined,
    );

    expect(root.lines.slice(before).some((line) => line.ok !== undefined)).toBe(
      true,
    );
  });

  it("writes a run record for a repository with no commit", async () => {
    const { root, opened, host } = await open({ uncommitted: true });

    host.run(null);
    await settledRun(root, opened);

    const written = records(root);

    expect(written.length).toBeGreaterThan(0);
    expect(
      written[0].phases.map((one: { phase: string }) => one.phase),
    ).toEqual(["extract", "structure"]);
  });

  it("starts a scan from a second service over the same repository files", async () => {
    const { root } = await open();
    const before = records(root).length;
    const other = root.second();

    other.send("scan.start", { repository: root.repository });
    await other.until(() => (records(root).length > before ? true : undefined));

    expect(records(root).length).toBeGreaterThan(before);
  });
});
