import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../../tools/scripts/pool-scale.mjs";
import { appRoot } from "../roots";

function survivors(marker: string): string[] {
  const result = spawnSync("pgrep", ["-f", marker], { encoding: "utf8" });

  return result.stdout.split("\n").filter((pid) => pid !== "");
}

describe("the app root's scanner when the service dies without cleaning up", () => {
  afterEach(() => {
    delete process.env.RECOGNIZER_SHIM_LIFETIME;
  });

  it(
    "ends the scanner on its own once its shim lifetime runs out",
    async () => {
      process.env.RECOGNIZER_SHIM_LIFETIME = "2";

      const root = await appRoot({
        own: true,
        stamped: true,
        launchers: {
          "recognizer-scan-typescript": [
            `case "$1" in`,
            `run) exec sleep 600;;`,
            `*) exit 0;;`,
            `esac`,
          ].join("\n"),
        },
      });

      await root.service.call("scan.start", {
        repository: root.repository,
        sense: [],
        extract: true,
        describe: false,
      });

      const deadline = Date.now() + scaledTimeout(20_000);

      while (survivors(root.plugins).length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      expect(survivors(root.plugins)).not.toEqual([]);

      const ended = new Promise<void>((resolve) =>
        root.service.child.once("exit", resolve),
      );

      root.service.child.kill("SIGKILL");
      await ended;
      await new Promise((resolve) => setTimeout(resolve, 4_000));

      const left = survivors(root.plugins);

      for (const pid of left) {
        process.kill(Number(pid), "SIGKILL");
      }

      expect(left).toEqual([]);
    },
    scaledTimeout(60_000),
  );
});
