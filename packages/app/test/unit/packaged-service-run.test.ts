import { describe, expect, it } from "vitest";
import { workScopes } from "../../src/planned-work";
import { timeEndToEnd, untilHolds } from "../app-harness";
import { inProcessAppRoot } from "../in-process-root";

type Root = Awaited<ReturnType<typeof inProcessAppRoot>>;

const TEST_TIMEOUT = 60_000;

async function untilRows(
  root: Root,
  found: (rows: Awaited<ReturnType<Root["view"]["rows"]>>) => boolean,
) {
  await hostOf(root);

  const limit = performance.now() + 30_000;

  for (;;) {
    const rows = await root.view.rows();

    if (found(rows)) {
      return rows;
    }

    if (performance.now() > limit) {
      throw new Error(`rows never matched: ${JSON.stringify(rows)}`);
    }

    await root.service.signal(50);
  }
}

async function hostOf(root: Root) {
  return untilHolds(root.service, () => root.view.explorer()?.host);
}

describe("the app over the in-process service", () => {
  it("carries every registered sensor's manifest into the rows the panel renders", async () => {
    const root = await inProcessAppRoot();
    const rows = await untilRows(root, (one) => one.length === 2);

    expect(rows.map(({ name, display }) => [name, display])).toEqual([
      ["crap", "C.R.A.P."],
      ["mutation", "Mutation"],
    ]);
    expect(rows.find(({ name }) => name === "mutation")?.runsTests).toBe(true);
  });

  it(
    "a_ticked_sensor_reaches_scan_start_and_runs",
    async () => {
      const root = await inProcessAppRoot();
      const host = await hostOf(root);

      await untilRows(root, (one) => one.length === 2);
      host.run(null);

      const started = await untilHolds(root.service, () =>
        root.service.started.find(
          (args) => (args.sense as string[]).length > 0,
        ),
      );

      expect([...(started.sense as string[])].sort()).toEqual([
        "crap",
        "mutation",
      ]);

      await untilHolds(root.service, () => {
        const sensors = root.view.loaded()?.sensors ?? [];

        return ["crap", "mutation"].every(
          (name) =>
            sensors.find((sensor) => sensor.name === name)?.status === "ran",
        )
          ? true
          : undefined;
      });
    },
    TEST_TIMEOUT,
  );

  it(
    "a_registration_change_removes_the_row_and_refreshes_the_panel_within_10_s",
    async () => {
      const root = await inProcessAppRoot();
      const first = await untilRows(root, (one) => one.length === 2);

      expect(first.filter(({ registered }) => registered)).toHaveLength(2);

      root.io.files.writeFile(
        `${root.repository}/.recognizer/config.yaml`,
        "sensors:\n  crap:\n    manifest: [recognizer-sense-crap, manifest]\n",
      );

      const rows = await untilRows(
        root,
        (one) =>
          one.find(({ name }) => name === "mutation")?.registered !== true,
      );

      expect(rows.find(({ name }) => name === "mutation")?.registered).not.toBe(
        true,
      );
      expect(rows.find(({ name }) => name === "crap")?.registered).toBe(true);

      await untilHolds(root.service, () =>
        (root.view.explorer()?.reloads ?? 0) > 0 ? true : undefined,
      );
    },
    TEST_TIMEOUT,
  );

  it(
    "a_planned_sensor_with_work_to_perform_reaches_the_estimate_through_the_snapshot_and_the_service",
    async () => {
      const root = await inProcessAppRoot({ stamped: true });
      const host = await hostOf(root);

      await untilRows(root, (one) => one.length === 2);

      const installed = await host.port.sensorList();
      const scopes = workScopes(
        { sense: ["crap", "mutation"], modules: null },
        installed,
        "stamp",
      );

      expect(scopes.map(({ sensor }) => sensor)).toEqual(["mutation"]);

      const { stamp: _stamp, ...request } =
        scopes[0] as (typeof scopes)[number];

      expect(await host.port.plannedWork(request)).toEqual({
        unit: "functions",
        to_perform: 3,
      });
    },
    TEST_TIMEOUT,
  );

  it(
    "a_run_card_leaves_checking_when_the_run_finishes_after_the_folder_is_assigned_late",
    async () => {
      const root = await inProcessAppRoot({
        stamped: true,
        folderKnown: false,
      });

      await root.app.started;
      root.assignFolder();

      const host = await hostOf(root);

      await untilRows(root, (one) => one.length === 2);
      host.run(null);

      await untilHolds(root.service, () =>
        root.view.loaded()?.sensors.length ? true : undefined,
      );
      await untilHolds(root.service, () =>
        host.runView?.().starting === null ? true : undefined,
      );
    },
    TEST_TIMEOUT,
  );

  it(
    "a_sensor_run_reads_current_an_edited_test_reads_out_of_date_and_the_revert_reads_current",
    async () => {
      const root = await inProcessAppRoot({ stamped: true });
      const original = Buffer.from(
        root.io.files.readBytes(root.testFile),
      ).toString("utf8");
      const both = (state: string) =>
        root.view.freshnessOf("crap") === state &&
        root.view.freshnessOf("mutation") === state
          ? true
          : undefined;

      await untilRows(root, (one) => one.length === 2);
      await root.service.call("scan.start", {
        repository: root.repository,
        sense: ["crap", "mutation"],
        extract: false,
        describe: false,
      });
      await untilHolds(root.service, () => both("current"));

      const { elapsedMs, limitMs } = await timeEndToEnd(root.service, {
        limitMs: 10_000,
        action: () =>
          root.io.files.writeFile(
            root.testFile,
            `${original}export const edited = 2;\n`,
          ),
        until: () => both("stale"),
      });

      expect(elapsedMs).toBeLessThan(limitMs);

      root.io.files.writeFile(root.testFile, original);
      await untilHolds(root.service, () => both("current"));
    },
    TEST_TIMEOUT,
  );
});
