import { discoverPlugins } from "@recognizer/core";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { nodeIo } from "../src/cli.js";
import { manifestPorts } from "../src/manifest-ports.js";
import { exampleManifest } from "./installed-read.js";
import { writeShim } from "./plugin-path.js";
import { useRegisteredShims } from "./plugin-registry-shim.js";

const savedPath = process.env.PATH;
const savedDirs = process.env.RECOGNIZER_PLUGIN_DIRS;

afterEach(() => {
  process.env.PATH = savedPath;

  if (savedDirs === undefined) {
    delete process.env.RECOGNIZER_PLUGIN_DIRS;
  } else {
    process.env.RECOGNIZER_PLUGIN_DIRS = savedDirs;
  }
});

describe("useRegisteredShims", () => {
  it("finds a written shim with PATH holding no shim directory and restores the variable", () => {
    const directory = makeTempDir("recognizer-registered-shim-");

    writeShim(directory, "recognizer-sense-crap", exampleManifest("crap"));
    process.env.PATH = "/usr/bin:/bin";
    process.env.RECOGNIZER_PLUGIN_DIRS = "before";

    const release = useRegisteredShims(directory);
    const found = discoverPlugins(manifestPorts(nodeIo()), ["sensor"]);

    release();

    expect(found.unreadable).toEqual([]);
    expect(found.plugins.length).toBeGreaterThan(0);
    expect(found.plugins.map((plugin) => plugin.name)).toEqual(["crap"]);
    expect(process.env.RECOGNIZER_PLUGIN_DIRS).toBe("before");
  });
});
