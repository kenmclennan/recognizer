import { describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../../tools/scripts/pool-scale.mjs";
import { makeTempDir } from "../../../../tools/scripts/temp-dirs.mjs";
import { Serve } from "../roots";

describe("the service test root after it is stopped", () => {
  it(
    "refuses a call with an error instead of writing to the ended stream",
    async () => {
      const errors: Error[] = [];
      const record = (error: Error) => errors.push(error);

      process.on("uncaughtException", record);

      const service = new Serve(makeTempDir("serve-after-stop-"));

      service.stop();

      await expect(service.call("inputs.read", {})).rejects.toThrow(
        /service stopped/,
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
      process.off("uncaughtException", record);

      expect(errors).toEqual([]);
    },
    scaledTimeout(30_000),
  );
});
