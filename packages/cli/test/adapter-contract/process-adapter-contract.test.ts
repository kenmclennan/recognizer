import type { ProcessControl } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { ProcessAdapter } from "../../src/adapters/plugins/process-adapter.js";
import { nodeIo } from "../../src/cli.js";
import { StopScope } from "../../src/stop-scope.js";
import { FakeProcess } from "../support/index.js";

function suite(
  title: string,
  make: () => { process: ProcessControl; hold: () => () => number },
): void {
  describe(title, () => {
    it("stopAll releases every registered holder once", async () => {
      const { process: control, hold } = make();
      const first = hold();
      const second = hold();

      await control.stopAll();
      await control.stopAll();

      expect(first()).toBe(1);
      expect(second()).toBe(1);
    });
  });
}

suite("Process contract (fake)", () => {
  const process = new FakeProcess();

  return {
    process,
    hold: () => {
      let released = 0;

      process.onStop(() => {
        released += 1;
      });

      return () => released;
    },
  };
});

suite("Process contract (real adapter)", () => {
  const scope = new StopScope();

  return {
    process: new ProcessAdapter(nodeIo(scope), () => []),
    hold: () => {
      let released = 0;
      const remove = scope.onStop(async () => {
        released += 1;
        remove();
      });

      return () => released;
    },
  };
});
