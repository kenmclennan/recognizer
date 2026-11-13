import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { fakeIo, ROOT } from "./scan-helpers.js";
import { readExamples } from "./shipped-read.js";

describe("readShippedSensors", () => {
  it("returns three entries in names order, listed for those with a metric", () => {
    const read = readExamples();

    expect(read.unreadable).toEqual([]);
    expect(read.sensors.map((one) => one.name)).toEqual([
      "crap",
      "mutation",
      "thresholds",
    ]);
    expect(read.sensors.map((one) => one.listed)).toEqual([true, true, false]);
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

  it("names the unreadable sensor with its reason and keeps the others", () => {
    const read = readExamples(["mutation"]);

    expect(read.sensors.map((one) => one.name)).toEqual(["crap", "thresholds"]);
    expect(read.unreadable).toEqual([
      {
        name: "mutation",
        reason: "recognizer-sense-mutation manifest exited 1",
      },
    ]);
  });

  it("reads only the names it is given", () => {
    const read = readExamples([], ["thresholds"]);

    expect(read.sensors.map((one) => one.name)).toEqual(["thresholds"]);
  });
});

describe("one manifest read per plugin in a scan", () => {
  it("runs no more manifests than the sensors a scan selects", async () => {
    const fake = fakeIo({
      sensorManifests: true,
      commit: "abc",
      files: {
        [`${ROOT}/.recognizer/config.yaml`]:
          "sensors:\n  crap: {}\n  mutation: {}\n",
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
