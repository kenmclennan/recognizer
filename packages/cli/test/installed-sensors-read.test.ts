import {
  commandKey,
  type ManifestRead,
  readInstalledSensors,
  readRegisteredSensors,
} from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import {
  exampleManifest,
  examplePorts,
  readExamples,
} from "./installed-read.js";
import { registeredPlugins } from "./registered-plugins.js";
import { fakeIo, ROOT } from "./scan-helpers.js";

describe("readInstalledSensors", () => {
  it("returns three entries in names order, listed for those with a metric", () => {
    const read = readExamples();

    expect(read.unreadable).toEqual([]);
    expect(read.sensors.map((one) => one.name)).toEqual(["crap", "mutation"]);
    expect(read.sensors.map((one) => one.listed)).toEqual([true, true]);
  });

  it("builds an entry from the manifest only", () => {
    const [crap] = readExamples().sensors;

    expect(crap).toMatchObject({
      display: "C.R.A.P.",
      expansion: "C.R.A.P.: Change Risk Anti-Patterns.",
      runs_tests: true,
      scoped: false,
    });
    expect(Object.keys(crap ?? {})).not.toContain("defaults");
  });

  it("omits description and expansion when the manifest omits them", () => {
    const [, mutation] = readExamples().sensors;

    expect(Object.keys(mutation ?? {})).not.toContain("expansion");
  });

  it("passes planned_work, log_path and unlisted through when declared and omits them when not", () => {
    const declaring = exampleManifest("mutation");
    const crap = exampleManifest("crap");
    const bare = { ...crap, metrics: [{ ...(crap.metrics?.[0] as object) }] };

    delete (bare as { log_path?: string }).log_path;
    delete (bare.metrics[0] as { unlisted?: boolean }).unlisted;

    const manifests = { mutation: declaring, crap: bare as typeof crap };
    const read = readInstalledSensors(
      examplePorts(),
      (prefix) => ({
        ok: true,
        manifest:
          manifests[
            (prefix[0] as string).replace(
              "recognizer-sense-",
              "",
            ) as keyof typeof manifests
          ],
      }),
      ["mutation", "crap"],
    );
    const first = read.sensors.find((one) => one.name === "mutation");
    const second = read.sensors.find((one) => one.name === "crap");

    expect(first?.planned_work).toEqual({ verb: "mutate" });
    expect(first?.log_path).toBe(".recognizer/cache/coverage/last-run.log");
    expect(Object.keys(second ?? {})).not.toContain("planned_work");
    expect(Object.keys(second ?? {})).not.toContain("log_path");
    expect(Object.keys(second?.metrics[0] ?? {})).not.toContain("unlisted");

    const full = readExamples().sensors[0];

    expect(
      full?.metrics.filter((one) => one.unlisted).map((one) => one.name),
    ).toEqual(["complexity"]);
  });

  it("names the unreadable sensor with its reason and keeps the others", () => {
    const read = readExamples(["mutation"]);

    expect(read.sensors.map((one) => one.name)).toEqual(["crap"]);
    expect(read.unreadable).toEqual([
      {
        name: "mutation",
        reason: "recognizer-sense-mutation manifest exited 1",
      },
    ]);
  });

  it("reads only the names it is given", () => {
    const read = readExamples([], ["mutation"]);

    expect(read.sensors.map((one) => one.name)).toEqual(["mutation"]);
  });
});

describe("one manifest read per plugin in a scan", () => {
  it("runs no more manifests than the sensors a scan selects", async () => {
    const registered = registeredPlugins([
      { kind: "sensor", name: "crap" },
      { kind: "sensor", name: "mutation" },
    ]);
    const fake = fakeIo({
      sensorManifests: true,
      env: registered.env,
      commit: "abc",
      files: {
        ...registered.files,
        [`${ROOT}/.recognizer/config.yaml`]:
          "sensors:\n  crap:\n    manifest: [recognizer-sense-crap, manifest]\n  mutation:\n    manifest: [recognizer-sense-mutation, manifest]\n",
      },
    });

    const code = await run(["scan", ROOT, "--sense", "crap,mutation"], fake.io);
    const manifests = fake.calls.filter(
      (call) =>
        call.command.startsWith("recognizer-sense-") &&
        call.args.at(-1) === "manifest",
    );

    expect(code).toBeTypeOf("number");
    expect(manifests.length).toBeGreaterThan(0);
    expect(manifests.map((call) => call.command).sort()).toEqual([
      "recognizer-sense-crap",
      "recognizer-sense-mutation",
    ]);
  });
});

describe("readRegisteredSensors", () => {
  const sensor = (name: string, manifest?: string[]) => ({
    name,
    command: ["python3", `${name}.py`, "run"],
    ...(manifest === undefined ? {} : { manifest }),
  });

  function reader(answers: Record<string, ManifestRead>) {
    const calls: string[][] = [];

    return {
      calls,
      read: (words: string[]): ManifestRead => {
        calls.push(words);

        return (
          answers[commandKey(words)] ?? {
            ok: false,
            reason: "could not be started",
          }
        );
      },
    };
  }

  const good = (name: string): ManifestRead => ({
    ok: true,
    manifest: exampleManifest(name),
  });

  it("reads exactly the manifest words and keys the entry by the run command", () => {
    const manifest = ["python3", "tools/sense.py", "manifest"];
    const { calls, read } = reader({ [commandKey(manifest)]: good("crap") });
    const one = sensor("crap", manifest);
    const result = readRegisteredSensors([one], read);

    expect(calls).toEqual([manifest]);
    expect(Object.keys(result.entries)).toEqual([commandKey(one.command)]);
    expect(result.entries[commandKey(one.command)]?.runs_tests).toBe(true);
    expect(result.unreadable).toEqual([]);
  });

  it("does not read a sensor with no manifest and records nothing for it", () => {
    const { calls, read } = reader({});
    const result = readRegisteredSensors([sensor("crap")], read);

    expect(calls).toEqual([]);
    expect(result).toEqual({ entries: {}, unreadable: [] });
  });

  it("does not read a recognizer-sense program with no manifest either", () => {
    const { calls, read } = reader({});
    const result = readRegisteredSensors(
      [
        {
          name: "crap",
          command: ["recognizer-sense-crap", "run"],
        },
      ],
      read,
    );

    expect(calls).toEqual([]);
    expect(result).toEqual({ entries: {}, unreadable: [] });
  });

  it("reads two sensors that share a manifest command once", () => {
    const manifest = ["shared", "manifest"];
    const { calls, read } = reader({ [commandKey(manifest)]: good("crap") });

    readRegisteredSensors(
      [sensor("one", manifest), sensor("two", manifest)],
      read,
    );

    expect(calls).toHaveLength(1);
  });

  it("returns an entry for exactly the readable sensor among a failing and a non-sensor one", () => {
    const ok = ["ok", "manifest"];
    const bad = ["bad", "manifest"];
    const scanner = ["scanner", "manifest"];
    const { calls, read } = reader({
      [commandKey(ok)]: good("crap"),
      [commandKey(scanner)]: {
        ok: true,
        manifest: { ...exampleManifest("crap"), kind: "scanner" },
      },
    });
    const result = readRegisteredSensors(
      [sensor("good", ok), sensor("bad", bad), sensor("scan", scanner)],
      read,
    );

    expect(calls).toHaveLength(3);
    expect(Object.keys(result.entries)).toEqual([
      commandKey(sensor("good").command),
    ]);
    expect(result.unreadable.map((one) => one.name)).toEqual(["bad", "scan"]);
    expect(result.unreadable[0]?.reason).toBe("could not be started");
    expect(result.unreadable[1]?.reason).toContain("is not a sensor");
  });
});
