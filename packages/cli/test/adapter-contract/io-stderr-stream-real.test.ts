import { EVENT_PREFIX } from "@recognizer/core";
import { afterAll, describe, expect, it } from "vitest";
import { makeTempDir } from "../../../../tools/scripts/temp-dirs.mjs";
import { nodeIo, STDERR_TAIL_LIMIT } from "../../src/cli.js";
import { StopScope } from "../../src/stop-scope.js";
import { launcher } from "../serve-harness.js";

const scope = new StopScope();

afterAll(() => scope.stop(0, 100));

describe("a real plugin's stderr stream", () => {
  it("keeps only a bounded non-event tail while every event line reaches the reader", async () => {
    const directory = makeTempDir("io-stderr-stream-");
    const events = 100_000;
    const payload = "x".repeat(200);

    launcher(
      directory,
      "noisy",
      `awk 'BEGIN {
  for (i = 0; i < ${events}; i++) print "${EVENT_PREFIX}{\\"event\\":\\"result\\",\\"pad\\":\\"${payload}\\"}" > "/dev/stderr"
  for (i = 0; i < 20000; i++) print "noise " i > "/dev/stderr"
  print "last words" > "/dev/stderr"
}'`,
    );

    let seen = 0;

    const result = await nodeIo(scope).runAsync(`${directory}/noisy`, [], {
      onStderrLine: (line) => {
        if (line.startsWith(EVENT_PREFIX)) {
          seen += 1;

          return true;
        }

        return false;
      },
    }).result;

    expect(seen).toBe(events);
    expect(result.stderr.length).toBeLessThanOrEqual(STDERR_TAIL_LIMIT);
    expect(result.stderr).not.toContain(EVENT_PREFIX);
    expect(result.stderr.endsWith("noise 19999\nlast words\n")).toBe(true);
  }, 60_000);
});
