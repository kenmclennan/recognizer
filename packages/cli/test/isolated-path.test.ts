import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../tools/scripts/pool-scale.mjs";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { exampleManifest } from "./installed-read.js";
import { isolatedPath } from "./isolated-path.js";
import { writeShim } from "./plugin-path.js";
import { BIN } from "./serve-harness.js";

const TIMEOUT = scaledTimeout(60_000);

function sensors(path: string) {
  return spawnSync(process.execPath, [BIN, "sensors", "--json"], {
    env: { ...process.env, PATH: path },
    encoding: "utf8",
  });
}

describe("isolated plugin path", () => {
  it(
    "ignores a stray sensor on the inherited PATH",
    () => {
      const stray = makeTempDir("isolated-path-stray-");
      const own = makeTempDir("isolated-path-own-");
      const manifest = (name: string) => ({
        ...exampleManifest("crap"),
        name,
      });

      writeShim(stray, "recognizer-sense-stray", manifest("stray"));
      writeShim(own, "recognizer-sense-own", manifest("own"));

      const inherited = `${stray}:${process.env.PATH}`;

      const isolated = sensors(isolatedPath(own));

      expect(sensors(inherited).stdout).toContain("stray");
      expect(isolated.status).toBe(0);
      expect(
        JSON.parse(isolated.stdout).map((e: { name: string }) => e.name),
      ).toEqual(["own"]);
      expect(isolatedPath(own).split(":")).not.toContain(stray);
    },
    TIMEOUT,
  );
});
