import { discoverPlugins } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { manifestPorts } from "../src/manifest-ports.js";
import {
  ioWithRegistry,
  manifestFor,
  tempDirectory,
  writeShim,
} from "./plugin-path.js";

describe("ioWithRegistry", () => {
  it("finds shims written before and after it was made", () => {
    const first = tempDirectory("recognizer-registry-io-");
    const second = tempDirectory("recognizer-registry-io-");

    writeShim(first, "recognizer-scan-a", manifestFor("scanner", "a"));

    const io = ioWithRegistry([first, second]);

    writeShim(second, "recognizer-scan-b", manifestFor("scanner", "b"));

    const found = discoverPlugins(manifestPorts(io));

    expect(found.plugins.map((plugin) => plugin.name).sort()).toEqual([
      "a",
      "b",
    ]);
    expect(found.unreadable).toEqual([]);
  });
});
