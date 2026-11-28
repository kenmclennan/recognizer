import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  discoverPlugins as discover,
  judgeScanSchema as judgeSchema,
  type PluginKind,
} from "@recognizer/core";
import { describe, expect, it } from "vitest";
import type { Io } from "../src/cli.js";
import { manifestPorts } from "../src/manifest-ports.js";
import { SCAN_BREAKING_VERSIONS, SCAN_SCHEMA_VERSION } from "../src/scan.js";
import {
  ioWithPath,
  ioWithRegistry,
  manifestFor,
  tempDirectory,
  writeShim,
} from "./plugin-path.js";

const discoverPlugins = (io: Io, kinds?: readonly PluginKind[]) =>
  discover(manifestPorts(io), kinds);

const judgeScanSchema = (
  declared: number | undefined,
  current: number = SCAN_SCHEMA_VERSION,
  breaks: readonly number[] = SCAN_BREAKING_VERSIONS,
) => judgeSchema(declared, current, breaks);

function setup() {
  const first = tempDirectory("recognizer-discovery-");
  const second = tempDirectory("recognizer-discovery-");

  return {
    first,
    second,
    io: ioWithRegistry([first, second]),
    pathIo: ioWithPath([first, second]),
  };
}

describe("discoverPlugins", () => {
  it("lists a readable registered plugin and names an unreadable one", () => {
    const { first, io } = setup();

    writeShim(
      first,
      "recognizer-scan-a",
      manifestFor("scanner", "a", { version: "1.0.0" }),
    );
    writeShim(first, "recognizer-scan-b", "not a manifest");

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

  it("names a PATH folder that cannot be read apart from one with no plugins", () => {
    const { first, second } = setup();
    const missing = join(second, "gone");
    const io = ioWithPath([first, missing]);

    expect(manifestPorts(io).programs.unreadableOnPath()).toEqual([missing]);
    expect(manifestPorts(io).programs.listOnPath(["recognizer-"])).toEqual([]);
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
    const { pathIo: io } = setup();

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
});

describe("judgeScanSchema", () => {
  it("is undeclared when nothing is declared", () => {
    expect(judgeScanSchema(undefined)).toBe("undeclared");
  });

  it.each([
    [7, 7, [7], "current"],
    [8, 7, [7], "newer"],
    [6, 7, [7], "broken"],
    [6, 8, [7], "broken"],
    [7, 8, [7], "older"],
    [1, 7, [], "older"],
  ] as const)(
    "judges %i against %i with breaks %j as %s",
    (declared, current, breaks, verdict) => {
      expect(judgeScanSchema(declared, current, breaks)).toBe(verdict);
    },
  );
});

describe("discoverPlugins and the scan schema", () => {
  it("sets schema from the manifest's declared version", () => {
    const { first, io } = setup();

    writeShim(
      first,
      "recognizer-scan-a",
      manifestFor("scanner", "a", { scan_schema_version: 8 }),
    );
    writeShim(
      first,
      "recognizer-scan-b",
      manifestFor("scanner", "b", { scan_schema_version: 7 }),
    );
    writeShim(first, "recognizer-sense-s", manifestFor("sensor", "s"));

    const schemas = Object.fromEntries(
      discoverPlugins(io).plugins.map((one) => [one.name, one.schema]),
    );

    expect(schemas).toEqual({ a: "newer", b: "current", s: "undeclared" });
  });
});
