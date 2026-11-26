import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { run } from "../src/cli.js";
import {
  ioWithPath,
  manifestFor,
  tempDirectory,
  writeShim,
} from "./plugin-path.js";

interface Out {
  code: number;
  out: string;
  err: string;
}

function setup() {
  const bin = tempDirectory("recognizer-register-bin-");
  const root = makeTempDir("recognizer-register-folders-");
  const folders = { homebrew: join(root, "brew"), user: join(root, "user") };
  const base = ioWithPath([bin]);
  let out = "";
  let err = "";
  const io = {
    ...base,
    env: (name: string) =>
      name === "RECOGNIZER_PLUGIN_DIRS"
        ? `${folders.homebrew}:${folders.user}`
        : base.env(name),
    stdout: (text: string) => {
      out += text;
    },
    stderr: (text: string) => {
      err += text;
    },
  };

  return {
    bin,
    folders,
    command: async (args: string[]): Promise<Out> => {
      out = "";
      err = "";

      const code = await run(["plugin", ...args], io);

      return { code, out, err };
    },
    written: (file: string) =>
      JSON.parse(readFileSync(join(folders.user, file), "utf8")),
  };
}

describe("recognizer plugin register", () => {
  it("registers a sensor", async () => {
    const { bin, command, written, folders } = setup();
    const path = writeShim(bin, "tally-prog", manifestFor("sensor", "tally"));
    const { code, out } = await command(["register", path]);

    expect(code).toBe(0);
    expect(out.trim().split("\n")).toHaveLength(1);
    expect(out).toContain("sensor tally");
    expect(out).toContain(join(folders.user, "sensor-tally.json"));
    expect(written("sensor-tally.json")).toEqual({
      registration_version: 1,
      kind: "sensor",
      name: "tally",
      command: [path],
      manifest: [path, "manifest"],
    });
  });

  it("registers a scanner", async () => {
    const { bin, command, written } = setup();
    const path = writeShim(bin, "lang-prog", manifestFor("scanner", "lang"));
    const { code } = await command(["register", path]);

    expect(code).toBe(0);
    expect(written("scanner-lang.json").command).toEqual([path]);
  });

  it("registers a describer and makes it the newest", async () => {
    const { bin, command, folders } = setup();
    const first = writeShim(
      bin,
      "first-prog",
      manifestFor("describer", "first"),
    );
    const second = writeShim(
      bin,
      "second-prog",
      manifestFor("describer", "second"),
    );

    expect((await command(["register", first])).code).toBe(0);
    expect((await command(["register", second])).code).toBe(0);
    expect(readdirSync(folders.user).sort()).toEqual([
      "describer-first.json",
      "describer-second.json",
    ]);
    expect((await command(["register", first])).code).toBe(0);
    expect(existsSync(join(folders.user, "describer-first.json"))).toBe(true);
  });

  it("registers a program found by bare name on PATH", async () => {
    const { bin, command, written } = setup();
    const path = writeShim(bin, "bare-prog", manifestFor("sensor", "bare"));

    expect((await command(["register", "bare-prog"])).code).toBe(0);
    expect(written("sensor-bare.json").command).toEqual([path]);
  });

  it("refuses a manifest that fails protocol", async () => {
    const { bin, command, folders } = setup();
    const path = writeShim(
      bin,
      "old-prog",
      manifestFor("sensor", "old", { protocol: 99 }),
    );
    const { code, err } = await command(["register", path]);

    expect(code).toBe(1);
    expect(err).toContain("plugin register");
    expect(existsSync(folders.user)).toBe(false);
  });
});

describe("recognizer plugin unregister", () => {
  it("unregister removes only the user file", async () => {
    const { bin, command, folders } = setup();
    const path = writeShim(bin, "tally-prog", manifestFor("sensor", "tally"));

    await command(["register", path]);

    const { code } = await command(["unregister", "tally"]);

    expect(code).toBe(0);
    expect(existsSync(join(folders.user, "sensor-tally.json"))).toBe(false);
    expect((await command(["unregister", "tally"])).code).toBe(1);
  });

  it("unregister reports a homebrew-only registration", async () => {
    const { command, folders } = setup();
    const { mkdirSync, writeFileSync } = await import("node:fs");

    mkdirSync(folders.homebrew, { recursive: true });
    writeFileSync(
      join(folders.homebrew, "scanner-lang.json"),
      JSON.stringify({
        registration_version: 1,
        kind: "scanner",
        name: "lang",
        command: ["/x"],
        manifest: ["/x", "manifest"],
      }),
    );

    const { code, out } = await command(["unregister", "lang"]);

    expect(code).toBe(0);
    expect(out).toContain("brew uninstall");
    expect(existsSync(join(folders.homebrew, "scanner-lang.json"))).toBe(true);
  });

  it("unregister refuses an ambiguous name", async () => {
    const { bin, command, folders } = setup();
    const sensor = writeShim(bin, "a-prog", manifestFor("sensor", "twin"));
    const scanner = writeShim(bin, "b-prog", manifestFor("scanner", "twin"));

    await command(["register", sensor]);
    await command(["register", scanner]);

    const { code, err } = await command(["unregister", "twin"]);

    expect(code).toBe(1);
    expect(err).toContain("--kind");
    expect(readdirSync(folders.user)).toHaveLength(2);
    expect(
      (await command(["unregister", "twin", "--kind", "sensor"])).code,
    ).toBe(0);
    expect(readdirSync(folders.user)).toEqual(["scanner-twin.json"]);
  });
});
