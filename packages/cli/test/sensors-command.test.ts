import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { type Io, type RunResult, run } from "../src/cli.js";
import { capture } from "./helpers.js";
import { exampleManifest } from "./installed-read.js";
import { REGISTRY_FOLDER, registeredPlugins } from "./registered-plugins.js";

function answering(
  failing: readonly string[] = [],
  garbage: readonly string[] = [],
  installed: readonly string[] = ["crap", "mutation"],
  manifestOf: (name: string) => unknown = exampleManifest,
) {
  const captured = capture();
  const registered = registeredPlugins(
    installed.map((name) => ({ kind: "sensor" as const, name })),
  );
  const io: Io = {
    ...captured.io,
    env: (name) => registered.env[name] ?? captured.io.env(name),
    exists: (path) => path === REGISTRY_FOLDER || captured.io.exists(path),
    readDir: (path) =>
      path === REGISTRY_FOLDER
        ? Object.keys(registered.files).map((file) => ({
            name: file.slice(REGISTRY_FOLDER.length + 1),
            kind: "file" as const,
          }))
        : captured.io.readDir(path),
    readFile: (path) => registered.files[path] ?? captured.io.readFile(path),
    run: (command): RunResult => {
      const name = command.replace("recognizer-sense-", "");

      if (failing.includes(name)) {
        return { started: true, status: 1, stdout: "", stderr: "boom" };
      }

      return {
        started: true,
        status: 0,
        stdout: garbage.includes(name)
          ? "not json"
          : JSON.stringify(manifestOf(name)),
        stderr: "",
      };
    },
  };

  return { io, out: captured.out, err: captured.err };
}

describe("recognizer sensors", () => {
  it("lists the registered sensors and no fixed pair", () => {
    const own = (name: string) => ({ ...exampleManifest("crap"), name });
    const { io, out, err } = answering([], [], ["tally", "margin"], own);

    expect(run(["sensors", "--json"], io)).toBe(0);
    expect(err()).toBe("");
    expect(JSON.parse(out()).map((e: { name: string }) => e.name)).toEqual([
      "margin",
      "tally",
    ]);
  });

  it("lists a sensor registered under a custom command with a manifest beside the installed ones, once, marked registered", () => {
    const repo = makeTempDir("recognizer-sensors-custom-");
    const tool = join(repo, "tally-tool");

    mkdirSync(join(repo, ".recognizer"));
    writeFileSync(
      join(repo, ".recognizer", "config.yaml"),
      `sensors:\n  tally:\n    command: [${tool}, run]\n    manifest: [${tool}, manifest]\n  tally-again:\n    command: [${tool}, run, again]\n    manifest: [${tool}, manifest]\n`,
    );

    const { io, out, err } = answering([], [], ["crap"], (name) => ({
      ...exampleManifest("crap"),
      name: name === tool ? "tally" : name,
    }));

    const code = run(["sensors", "--json", "--repository", repo], io);
    expect(code).toBe(0);
    expect(err()).toBe("");

    const entries = JSON.parse(out());

    expect(entries.map((e: { name: string }) => e.name)).toEqual([
      "crap",
      "tally",
    ]);
    expect(entries.map((e: { registered?: boolean }) => e.registered)).toEqual([
      undefined,
      true,
    ]);
  });

  it("prints an empty array and exits 0 when no sensor is installed", () => {
    const { io, out, err } = answering([], [], []);

    expect(run(["sensors", "--json"], io)).toBe(0);
    expect(err()).toBe("");
    expect(JSON.parse(out())).toEqual([]);
  });

  it("prints the entries of the manifests in the order of the names table and exits 0", () => {
    const { io, out, err } = answering();

    expect(run(["sensors", "--json"], io)).toBe(0);
    expect(err()).toBe("");

    const entries = JSON.parse(out());

    expect(entries.map((e: { name: string }) => e.name)).toEqual([
      "crap",
      "mutation",
    ]);
    expect(entries.map((e: { listed: boolean }) => e.listed)).toEqual([
      true,
      true,
    ]);
  });

  it("gives every entry the manifest keys and no defaults", () => {
    const { io, out } = answering();

    run(["sensors", "--json"], io);

    for (const entry of JSON.parse(out())) {
      expect(Object.keys(entry)).not.toContain("defaults");
      expect(Object.keys(entry)).not.toContain("line");
      expect(Object.keys(entry)).toEqual(
        expect.arrayContaining([
          "name",
          "display",
          "runs_tests",
          "scoped",
          "listed",
          "metrics",
          "findings",
          "settings",
        ]),
      );
    }
  });

  it("leaves out one unreadable sensor, names it on stderr and exits 1", () => {
    const { io, out, err } = answering(["mutation"]);

    expect(run(["sensors", "--json"], io)).toBe(1);
    expect(JSON.parse(out()).map((e: { name: string }) => e.name)).toEqual([
      "crap",
    ]);
    expect(err()).toMatch(/^mutation: .*exited 1/m);
    expect(err().trim().split("\n")).toHaveLength(1);
  });

  it("prints an empty array, three stderr lines and exits 1 when none resolve", () => {
    const { io, out, err } = answering(["crap", "mutation"]);

    expect(run(["sensors", "--json"], io)).toBe(1);
    expect(JSON.parse(out())).toEqual([]);
    expect(err().trim().split("\n")).toHaveLength(2);
  });

  it("counts a manifest that prints invalid JSON as unreadable", () => {
    const { io, err } = answering([], ["mutation"]);

    expect(run(["sensors", "--json"], io)).toBe(1);
    expect(err()).toMatch(/^mutation: .*did not print JSON/m);
  });

  it("prints name and description per line in text", () => {
    const { io, out } = answering();

    expect(run(["sensors"], io)).toBe(0);
    expect(out()).toMatch(/^crap {2}Runs the tests under coverage/m);
    expect(out().trim().split("\n")).toHaveLength(2);
  });

  it("exits 2 on an unknown flag", () => {
    const { io } = answering();

    expect(run(["sensors", "--bogus"], io)).toBe(2);
  });

  it("exits 2 on an extra argument", () => {
    const { io } = answering();

    expect(run(["sensors", "extra"], io)).toBe(2);
  });

  it("is named by help", () => {
    const { io, out } = answering();

    expect(run(["help", "sensors"], io)).toBe(0);
    expect(out()).toContain("recognizer sensors");
  });

  it("lists C.R.A.P. and Mutation, in the order the Scan panel shows them", () => {
    const { io, out } = answering();

    run(["sensors", "--json"], io);

    const shown = JSON.parse(out())
      .filter((e: { listed: boolean }) => e.listed)
      .map((e: { display: string }) => e.display);

    expect(shown).toEqual(["C.R.A.P.", "Mutation"]);
  });
});
