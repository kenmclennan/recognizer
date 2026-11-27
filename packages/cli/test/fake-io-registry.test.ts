import { discoverPlugins } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { manifestPorts } from "../src/manifest-ports.js";
import { FakeIo, sensorProgram } from "./support/index.js";

describe("FakeIo registry", () => {
  it("discovers an installed plugin through the registry with its fake command", () => {
    const io = new FakeIo({
      programs: { "recognizer-sense-crap": sensorProgram("crap") },
    });

    const found = discoverPlugins(manifestPorts(io), ["sensor"]);

    expect(found.plugins.map((plugin) => plugin.name)).toEqual(["crap"]);
    expect(found.plugins[0]?.command).toBe("/fake-bin/recognizer-sense-crap");
    expect(io.readDir("/fake-registry").map((entry) => entry.name)).toContain(
      "sensor-crap.json",
    );
  });

  it("lists a plugin whose manifest cannot be read apart from one that can", () => {
    const io = new FakeIo({
      programs: {
        "recognizer-sense-crap": sensorProgram("crap"),
        "recognizer-sense-mutation": () => ({
          started: true,
          status: 0,
          stdout: "not json",
          stderr: "",
        }),
      },
    });

    const found = discoverPlugins(manifestPorts(io), ["sensor"]);

    expect(found.plugins.map((plugin) => plugin.name)).toEqual(["crap"]);
    expect(found.unreadable.map((entry) => entry.command)).toEqual([
      "/fake-bin/recognizer-sense-mutation",
    ]);
  });

  it("registers nothing for a program that is not a plugin", () => {
    const io = new FakeIo({
      programs: {
        git: () => ({ started: true, status: 0, stdout: "", stderr: "" }),
      },
    });

    expect(io.exists("/fake-registry")).toBe(false);
  });
});
