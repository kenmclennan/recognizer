import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../../tools/scripts/pool-scale.mjs";
import { appRoot, timeEndToEnd, untilHolds } from "../roots";

type Root = Awaited<ReturnType<typeof appRoot>>;

const TEST_TIMEOUT = scaledTimeout(60_000) * 5;

async function untilRows(
  root: Root,
  found: (rows: Awaited<ReturnType<Root["view"]["rows"]>>) => boolean,
) {
  await hostOf(root);

  const limit = performance.now() + scaledTimeout(60_000);

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

describe("the app over the real service", () => {
  it(
    "a_sensor_run_reads_current_an_edited_test_reads_out_of_date_and_the_revert_reads_current",
    async () => {
      const root = await appRoot({ stamped: true });
      const original = readFileSync(root.testFile, "utf8");
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
          writeFileSync(root.testFile, `${original}export const edited = 2;\n`),
        until: () => both("stale"),
      });

      expect(elapsedMs).toBeLessThan(limitMs);

      writeFileSync(root.testFile, original);
      await untilHolds(root.service, () => both("current"));
    },
    TEST_TIMEOUT,
  );
});
