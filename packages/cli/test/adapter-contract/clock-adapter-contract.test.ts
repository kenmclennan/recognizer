import type { Clock } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { ClockAdapter } from "../../src/adapters/system/clock-adapter.js";
import { nodeIo } from "../../src/cli.js";
import { FakeClock } from "../support/index.js";

function suite(
  title: string,
  make: () => { clock: Clock; elapse: (ms: number) => Promise<void> },
): void {
  describe(title, () => {
    it("now and awake never decrease as time passes", async () => {
      const { clock, elapse } = make();
      const nows = [clock.now()];
      const awakes = [clock.awake()];

      for (let step = 0; step < 3; step += 1) {
        await elapse(5);
        nows.push(clock.now());
        awakes.push(clock.awake());
      }

      expect(nows.length).toBe(4);
      expect(nows).toEqual([...nows].sort((a, b) => a - b));
      expect(awakes).toEqual([...awakes].sort((a, b) => a - b));
    });
  });
}

suite("Clock contract (fake)", () => {
  const clock = new FakeClock();

  return {
    clock,
    elapse: async (ms) => {
      clock.advance(ms);
    },
  };
});

suite("Clock contract (real adapter)", () => ({
  clock: new ClockAdapter(nodeIo()),
  elapse: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}));
