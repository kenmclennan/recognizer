import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverPlugins } from "../src/plugin-discovery.js";
import {
  ioWithPath,
  manifestFor,
  tempDirectory,
  writeShim,
} from "./plugin-path.js";

function setup() {
  const first = tempDirectory("recognizer-discovery-");
  const second = tempDirectory("recognizer-discovery-");

  return { first, second, io: ioWithPath([first, second]) };
}

describe("discoverPlugins", () => {
  it("lists a readable plugin, names an unreadable one and ignores a repeat of a name later on PATH", () => {
    const { first, second, io } = setup();

    writeShim(
      first,
      "recognizer-scan-a",
      manifestFor("scanner", "a", { version: "1.0.0" }),
    );
    writeShim(first, "recognizer-scan-b", "not a manifest");
    writeShim(
      second,
      "recognizer-scan-a",
      manifestFor("scanner", "a", { version: "2.0.0" }),
    );

    const found = discoverPlugins(io);

    expect(found.plugins).toHaveLength(1);
    expect(found.plugins[0]).toMatchObject({
      kind: "scanner",
      name: "a",
      command: join(first, "recognizer-scan-a"),
      judgement: "current",
    });
    expect(found.plugins[0]?.manifest.version).toBe("1.0.0");
    expect(found.unreadable).toHaveLength(1);
    expect(found.unreadable[0]?.command).toBe(join(first, "recognizer-scan-b"));
    expect(found.unreadable[0]?.reason).toContain("did not print JSON");
  });

  it("skips a directory with a plugin name and a name with nothing after the prefix", () => {
    const { first, io } = setup();

    mkdirSync(join(first, "recognizer-scan-dir"));
    writeShim(first, "recognizer-scan-", manifestFor("scanner", "x"));

    expect(discoverPlugins(io)).toEqual({ plugins: [], unreadable: [] });
  });

  it("treats a manifest whose name differs from the file name as unreadable", () => {
    const { first, io } = setup();

    writeShim(first, "recognizer-scan-a", manifestFor("scanner", "other"));

    const found = discoverPlugins(io);

    expect(found.plugins).toEqual([]);
    expect(found.unreadable[0]?.reason).toContain("name is other, not a");
  });

  it("treats a manifest whose kind differs from the prefix as unreadable", () => {
    const { first, io } = setup();

    writeShim(first, "recognizer-sense-a", manifestFor("scanner", "a"));

    const found = discoverPlugins(io);

    expect(found.plugins).toEqual([]);
    expect(found.unreadable[0]?.reason).toContain(
      "kind is scanner, not sensor",
    );
  });

  it("finds nothing on a PATH with no plugin", () => {
    const { io } = setup();

    expect(discoverPlugins(io)).toEqual({ plugins: [], unreadable: [] });
  });

  it("reads only the kinds it is asked for", () => {
    const { first, io } = setup();

    writeShim(first, "recognizer-scan-a", manifestFor("scanner", "a"));
    writeShim(first, "recognizer-describe-d", manifestFor("describer", "d"));

    expect(
      discoverPlugins(io, ["describer"]).plugins.map((one) => one.name),
    ).toEqual(["d"]);
  });

  it("lists a plugin outside the protocol range with the judgement unsupported", () => {
    const { first, io } = setup();

    writeShim(
      first,
      "recognizer-scan-a",
      manifestFor("scanner", "a", { protocol: 9 }),
    );

    expect(discoverPlugins(io).plugins[0]?.judgement).toBe("unsupported");
  });

  it("skips a PATH directory that does not exist", () => {
    const { first } = setup();

    writeShim(first, "recognizer-scan-a", manifestFor("scanner", "a"));

    const io = ioWithPath(["/no/such/directory", first]);

    expect(discoverPlugins(io).plugins).toHaveLength(1);
  });
});
