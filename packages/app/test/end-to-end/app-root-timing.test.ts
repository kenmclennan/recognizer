import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../../tools/scripts/pool-scale.mjs";
import { appRoot, timeEndToEnd, untilHolds } from "../roots";

const EDIT_LIMIT_MS = 10_000;
const PULL_LIMIT_MS = 5_000;
const SCAN_CEILING_MS = 240_000;
const LOADED_TEST_TIMEOUT = scaledTimeout(SCAN_CEILING_MS) * 3;

const PULLS = [
  {
    number: 7,
    title: "Add the thing",
    headRefName: "feat/the-thing",
    headRefOid: "abcdef1234567890abcdef1234567890abcdef12",
    author: { login: "ken" },
    updatedAt: "2026-11-20T00:00:00Z",
    isDraft: false,
    statusCheckRollup: [],
  },
];

describe("the app root, timed end to end", () => {
  it(
    "an uncommitted test edit turns C.R.A.P. out of date within the limit",
    async () => {
      const root = await appRoot({ stamped: true });

      const host = await untilHolds(
        root.service,
        () => root.view.explorer()?.host,
        SCAN_CEILING_MS,
      );

      host.run(null);

      await untilHolds(
        root.service,
        () => (root.view.freshnessOf("crap") === "current" ? true : undefined),
        SCAN_CEILING_MS,
      );

      expect(root.view.freshnessOf("crap")).toBe("current");

      const { elapsedMs, limitMs } = await timeEndToEnd(root.service, {
        limitMs: EDIT_LIMIT_MS,
        action: () =>
          appendFileSync(root.testFile, "export const edited = 2;\n"),
        until: () =>
          root.view.freshnessOf("crap") === "stale" ? true : undefined,
      });

      expect(elapsedMs).toBeLessThan(limitMs);
      expect(readFileSync(root.testFile, "utf8")).toContain("edited");
    },
    LOADED_TEST_TIMEOUT,
  );

  it(
    "the scan panel stops reading running once the run has ended",
    async () => {
      const root = await appRoot({ stamped: true });

      const host = await untilHolds(
        root.service,
        () => root.view.explorer()?.host,
        SCAN_CEILING_MS,
      );

      host.run(null);

      await untilHolds(
        root.service,
        () => {
          const state = host.runView?.()?.run?.state;

          return state === "running" ? true : undefined;
        },
        SCAN_CEILING_MS,
      );

      await untilHolds(
        root.service,
        () => {
          const state = host.runView?.()?.run?.state;

          return state === "finished" ? true : undefined;
        },
        SCAN_CEILING_MS,
      );

      await untilHolds(
        root.service,
        () => (host.running() ? undefined : true),
        SCAN_CEILING_MS,
      );

      expect(host.running()).toBe(false);
    },
    LOADED_TEST_TIMEOUT,
  );

  it(
    "a pull-request read is answered while a scan runs",
    async () => {
      const root = await appRoot({ hold: true, pulls: PULLS });
      const { commitsSource } = await import("../../src/commits-source");

      const pid = join(root.gates, `${basename(root.repository)}.pid`);

      await untilHolds(
        root.service,
        () => (existsSync(pid) ? true : undefined),
        SCAN_CEILING_MS,
      );

      let reply: Awaited<
        ReturnType<typeof commitsSource.listPullRequests>
      > | null = null;

      const { elapsedMs, limitMs } = await timeEndToEnd(root.service, {
        limitMs: PULL_LIMIT_MS,
        action: () => {
          void commitsSource.listPullRequests().then((answer) => {
            reply = answer;
          });
        },
        until: () => (reply === null ? undefined : true),
      });

      expect(elapsedMs).toBeLessThan(limitMs);
      expect(existsSync(pid)).toBe(true);
      expect(
        (
          reply as unknown as { rows: { number: number; title: string }[] }
        ).rows.map(({ number, title }) => [number, title]),
      ).toEqual([[7, "Add the thing"]]);
    },
    LOADED_TEST_TIMEOUT,
  );
});
