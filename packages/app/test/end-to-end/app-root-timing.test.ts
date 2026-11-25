import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../../tools/scripts/pool-scale.mjs";
import { makeTempDir } from "../../../../tools/scripts/temp-dirs.mjs";
import { appRoot, REPO, timeEndToEnd, untilHolds } from "../roots";

const EDIT_LIMIT_MS = 10_000;
const PULL_LIMIT_MS = 5_000;
const TEST_TIMEOUT = scaledTimeout(60_000) * 5;

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

function heldScanner(gate: string): string {
  return [
    `case "$1" in`,
    `run)`,
    `  name=$(basename "$2")`,
    `  echo $$ > ${gate}/$name.pid`,
    `  trap 'exit 143' TERM`,
    `  while [ ! -e ${gate}/release ]; do sleep 0.1; done`,
    `  exec node ${REPO}/packages/scanners/typescript/dist/bin.js "$@";;`,
    `*) exec node ${REPO}/packages/scanners/typescript/dist/bin.js "$@";;`,
    `esac`,
  ].join("\n");
}

describe("the app root, timed end to end", () => {
  it(
    "an uncommitted test edit turns C.R.A.P. out of date within the limit",
    async () => {
      const root = await appRoot({ stamped: true });

      const host = await untilHolds(
        root.service,
        () => root.view.explorer()?.host,
      );

      host.run(null);

      await untilHolds(root.service, () =>
        root.view.freshnessOf("crap") === "current" ? true : undefined,
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
    TEST_TIMEOUT,
  );

  it(
    "a pull-request read is answered while a scan runs",
    async () => {
      const gate = makeTempDir("app-root-gate-");
      const list = join(gate, "pulls.json");

      writeFileSync(list, JSON.stringify(PULLS));

      const root = await appRoot({
        launchers: {
          "recognizer-scan-typescript": heldScanner(gate),
          gh: `cat ${list}`,
        },
      });
      const { commitsSource } = await import("../../src/commits-source");

      const pid = join(gate, `${basename(root.repository)}.pid`);

      await untilHolds(root.service, () =>
        existsSync(pid) ? true : undefined,
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
      expect(existsSync(join(gate, "release"))).toBe(false);
      expect(
        (
          reply as unknown as { rows: { number: number; title: string }[] }
        ).rows.map(({ number, title }) => [number, title]),
      ).toEqual([[7, "Add the thing"]]);
    },
    TEST_TIMEOUT,
  );
});
