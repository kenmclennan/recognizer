import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../../tools/scripts/pool-scale.mjs";
import { writersIn } from "../../../../tools/scripts/service-scratch-teardown.mjs";
import { makeTempDir } from "../../../../tools/scripts/temp-dirs.mjs";
import { appRoot, REPO } from "../roots";

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}

async function until(done: () => boolean, deadline: number): Promise<boolean> {
  while (!done() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return done();
}

describe("the app root's scanner when the service dies without cleaning up", () => {
  afterEach(() => {
    delete process.env.RECOGNIZER_SHIM_LIFETIME;
  });

  it(
    "ends the scanner on its own once its shim lifetime runs out",
    async () => {
      process.env.RECOGNIZER_SHIM_LIFETIME = "8";

      const pidFile = join(makeTempDir("app-shim-lifetime-"), "scanner.pid");

      const root = await appRoot({
        own: true,
        stamped: true,
        launchers: {
          "recognizer-scan-typescript": [
            `case "$1" in`,
            `run) echo $$ > "${pidFile}.tmp"; mv "${pidFile}.tmp" "${pidFile}"; exec sleep 600;;`,
            `*) exec node ${REPO}/packages/scanners/typescript/dist/bin.js "$@";;`,
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

      const started = await until(
        () => existsSync(pidFile),
        Date.now() + scaledTimeout(30_000),
      );

      expect(started).toBe(true);

      const pid = Number(readFileSync(pidFile, "utf8").trim());

      expect(alive(pid)).toBe(true);

      const ended = new Promise<void>((resolve) =>
        root.service.child.once("exit", resolve),
      );

      root.service.child.kill("SIGKILL");
      await ended;

      const gone = await until(
        () => !alive(pid),
        Date.now() + scaledTimeout(30_000),
      );

      if (!gone) {
        process.kill(pid, "SIGKILL");
      }

      expect(gone).toBe(true);

      await until(
        () => writersIn(root.service.scratch).length === 0,
        Date.now() + scaledTimeout(30_000),
      );
    },
    scaledTimeout(90_000),
  );
});
