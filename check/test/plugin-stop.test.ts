import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scaledTimeout } from "../../scripts/pool-scale.mjs";
import { makeTempDir } from "../scripts/temp-dirs.mjs";
import { nodeIo, stopEverything } from "../src/cli.js";
import { registerPending } from "../src/pending-checkpoints.js";

const GRACE = 400;

function alive(pid: number): boolean {
  return nodeIo().pidAlive(pid);
}

async function until(done: () => boolean, ms = 10_000): Promise<void> {
  for (let waited = 0; !done() && waited < ms; waited += 20) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function spawnPlugin(directory: string, name: string, body: string) {
  const io = nodeIo();
  const pidFile = join(directory, `${name}.pid`);
  const script = `
    require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
    ${body}
    setInterval(() => {}, 1000);
  `;
  const running = io.runAsync(process.execPath, ["-e", script]);

  return { running, pidFile };
}

describe("stopEverything", () => {
  it(
    "ends a plugin that exits on TERM, kills one that ignores it after the grace and promotes checkpoints after the wait",
    async () => {
      const directory = makeTempDir("plugin-stop-");
      const written = join(directory, "document.json");
      const exits = spawnPlugin(
        directory,
        "exits",
        `process.on("SIGTERM", () => {
          require("fs").writeFileSync(${JSON.stringify(written)}, "{}");
          process.exit(0);
        });`,
      );
      const ignores = spawnPlugin(
        directory,
        "ignores",
        `process.on("SIGTERM", () => {
          require("fs").writeFileSync(${JSON.stringify(join(directory, "got-term"))}, "");
        });`,
      );

      await until(
        () =>
          existsSync(exits.pidFile) &&
          existsSync(ignores.pidFile) &&
          readFileSync(exits.pidFile, "utf8") !== "" &&
          readFileSync(ignores.pidFile, "utf8") !== "",
      );

      const exitsPid = Number(readFileSync(exits.pidFile, "utf8"));
      const ignoresPid = Number(readFileSync(ignores.pidFile, "utf8"));

      expect(alive(exitsPid)).toBe(true);
      expect(alive(ignoresPid)).toBe(true);

      const promoted: { at: number; exitsAlive: boolean }[] = [];
      const began = Date.now();
      const unregister = registerPending(() => {
        promoted.push({ at: Date.now() - began, exitsAlive: alive(exitsPid) });
      });

      await stopEverything(undefined, GRACE);

      unregister();

      await until(() => !alive(ignoresPid));

      expect(Date.now() - began).toBeGreaterThanOrEqual(GRACE);
      expect(alive(exitsPid)).toBe(false);
      expect(alive(ignoresPid)).toBe(false);
      expect(existsSync(join(directory, "got-term"))).toBe(true);
      expect(promoted).toHaveLength(1);
      expect(promoted[0]?.exitsAlive).toBe(false);
      expect(promoted[0]?.at).toBeGreaterThanOrEqual(GRACE);
      expect(readFileSync(written, "utf8")).toBe("{}");

      await Promise.all([exits.running.result, ignores.running.result]);
    },
    scaledTimeout(30_000),
  );

  it(
    "returns at once when no plugin is running and still promotes checkpoints",
    async () => {
      const calls: string[] = [];
      const unregister = registerPending(() => calls.push("promoted"));

      await stopEverything(undefined, GRACE);

      unregister();

      expect(calls).toEqual(["promoted"]);
    },
    scaledTimeout(10_000),
  );

  it(
    "does not wait for the grace when every plugin has already exited",
    async () => {
      const directory = makeTempDir("plugin-stop-fast-");
      const quick = spawnPlugin(
        directory,
        "quick",
        `process.on("SIGTERM", () => process.exit(0));`,
      );

      await until(
        () =>
          existsSync(quick.pidFile) &&
          readFileSync(quick.pidFile, "utf8") !== "",
      );
      writeFileSync(join(directory, "unused"), "");

      const began = Date.now();

      await stopEverything(undefined, 5000);

      expect(Date.now() - began).toBeLessThan(4000);
      await quick.running.result;
    },
    scaledTimeout(15_000),
  );
});
