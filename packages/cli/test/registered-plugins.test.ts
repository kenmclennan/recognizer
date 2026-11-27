import { discoverPlugins } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import type { Io } from "../src/cli.js";
import { manifestPorts } from "../src/manifest-ports.js";
import { exampleManifest } from "./installed-read.js";
import {
  REGISTRY_FOLDER,
  type RegisteredEntry,
  registeredPlugins,
} from "./registered-plugins.js";
import { fakeIo } from "./support/scan-fake-io.js";

function registryIo(entries: RegisteredEntry[]): Io {
  const { files, env } = registeredPlugins(entries);
  const prefix = "recognizer-sense-";

  return {
    env: (name: string) => env[name],
    exists: (path: string) =>
      path === REGISTRY_FOLDER || Object.hasOwn(files, path),
    readDir: (path: string) =>
      Object.keys(files)
        .filter((file) => file.startsWith(`${path}/`))
        .map((file) => ({
          name: file.slice(path.length + 1),
          kind: "file" as const,
        })),
    readFile: (path: string) => files[path] ?? "",
    run: (command: string) =>
      command.startsWith(prefix)
        ? {
            started: true,
            status: 0,
            stdout: JSON.stringify(
              exampleManifest(command.slice(prefix.length)),
            ),
            stderr: "",
          }
        : { started: false, status: null, stdout: "", stderr: "" },
  } as unknown as Io;
}

describe("registeredPlugins", () => {
  it("serves a registered plugin to fakeIo without it being on PATH", () => {
    const { files, env } = registeredPlugins([
      { kind: "sensor", name: "crap" },
    ]);
    const { io } = fakeIo({ files, env, sensorManifests: true });

    const found = discoverPlugins(manifestPorts(io), ["sensor"]);

    expect(found.plugins).toHaveLength(1);
    expect(found.plugins[0]).toMatchObject({
      kind: "sensor",
      name: "crap",
      command: "recognizer-sense-crap",
    });
    expect(found.unreadable).toEqual([]);
  });

  it("lists a registered plugin whose manifest cannot be read as unreadable", () => {
    const io = registryIo([
      { kind: "sensor", name: "crap" },
      { kind: "scanner", name: "ghost" },
    ]);

    const sensors = discoverPlugins(manifestPorts(io), ["sensor"]);
    const scanners = discoverPlugins(manifestPorts(io), ["scanner"]);

    expect(sensors.plugins.map((plugin) => plugin.name)).toEqual(["crap"]);
    expect(scanners.plugins).toEqual([]);
    expect(scanners.unreadable.map((entry) => entry.command)).toEqual([
      "recognizer-scan-ghost",
    ]);
  });

  it("serves the default scanners through the registry and never lists PATH", () => {
    const { io, readDirCalls } = fakeIo();

    const found = discoverPlugins(manifestPorts(io), ["scanner"]);

    expect(found.plugins.length).toBeGreaterThan(0);
    expect(found.plugins.map((plugin) => plugin.name)).toEqual([
      "csharp",
      "kotlin",
      "python",
      "rust",
      "typescript",
    ]);
    expect(found.unreadable).toEqual([]);
    expect(readDirCalls()).toBe(0);
  });

  it("lists an unreadable scanner and no other when scanners are named", () => {
    const { io } = fakeIo({
      scanners: { "recognizer-scan-python": { manifest: "not json" } },
    });

    const found = discoverPlugins(manifestPorts(io), ["scanner"]);

    expect(found.plugins).toEqual([]);
    expect(found.unreadable.map((entry) => entry.command)).toEqual([
      "/fakebin/recognizer-scan-python",
    ]);
  });

  it("lists a mixed registry of readable, unreadable and sensor plugins", () => {
    const { io } = fakeIo({
      sensorManifests: true,
      onPath: ["recognizer-sense-crap"],
      scanners: {
        "recognizer-scan-python": {},
        "recognizer-scan-typescript": { manifest: "not json" },
      },
    });

    const scanners = discoverPlugins(manifestPorts(io), ["scanner"]);
    const sensors = discoverPlugins(manifestPorts(io), ["sensor"]);

    expect(scanners.plugins.length).toBeGreaterThan(0);
    expect(scanners.plugins.map((plugin) => plugin.name)).toEqual(["python"]);
    expect(scanners.unreadable.map((entry) => entry.command)).toEqual([
      "/fakebin/recognizer-scan-typescript",
    ]);
    expect(sensors.plugins.map((plugin) => plugin.name)).toEqual(["crap"]);
  });
});
