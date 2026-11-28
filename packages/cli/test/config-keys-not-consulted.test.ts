import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type DoctorReport,
  describerInEffect,
  sensorsInEffect,
} from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { readConfig } from "../src/config.js";
import { parseConfig } from "../src/config-parse.js";
import { manifestPorts } from "../src/manifest-ports.js";
import { REPO } from "./helpers.js";
import {
  ioWithRegistry,
  manifestFor,
  tempDirectory,
  writeShim,
} from "./plugin-path.js";

const OTHER_CONFIG = [
  "describer:",
  "  command: [other-describer, run, --model, '{model}', '{request}']",
  "  version: 'config-version'",
  "sensors:",
  "  mine:",
  "    command: [other-sensor, run]",
  "    manifest: [other-sensor, manifest]",
  "  ghost:",
  "    command: [ghost-sensor, run]",
  "    manifest: [ghost-sensor, manifest]",
  "install:",
  "  recognizer-sense-mine: config line for mine",
  "",
].join("\n");

function fixture(config: string) {
  const bin = tempDirectory("recognizer-keys-bin-");
  const repo = tempDirectory("recognizer-keys-repo-");

  mkdirSync(join(repo, ".recognizer"), { recursive: true });
  writeFileSync(join(repo, ".recognizer", "config.yaml"), config);

  return { bin, repo };
}

function registerPlugins(bin: string): void {
  writeShim(
    bin,
    "recognizer-sense-mine",
    manifestFor("sensor", "mine", {
      check: true,
      install: "manifest line for mine",
    }),
    {
      check: JSON.stringify({
        gaps: [{ code: "x", suite: null, line: "mine gap" }],
      }),
    },
  );
  writeShim(
    bin,
    "recognizer-describe-fake",
    manifestFor("describer", "fake", {
      prompt_version: "registry-version",
      check: false,
    }),
  );
}

async function doctor(repo: string, bin: string): Promise<DoctorReport> {
  let out = "";
  const base = ioWithRegistry([bin]);

  await run(["doctor", repo, "--json"], {
    ...base,
    stdout: (text: string) => {
      out += text;
    },
  });

  return JSON.parse(out) as DoctorReport;
}

describe("config keys are parsed and not consulted", () => {
  it("a config that registers a different sensor, describer and install line changes nothing", async () => {
    const { bin, repo } = fixture(OTHER_CONFIG);

    registerPlugins(bin);

    const io = ioWithRegistry([bin]);

    expect(sensorsInEffect(manifestPorts(io)).map((one) => one.name)).toEqual([
      "mine",
    ]);

    const located = describerInEffect(manifestPorts(io));

    expect(located).toMatchObject({ version: "registry-version" });
    expect(
      located !== null && "command" in located && located.command.slice(1),
    ).toEqual(["run", "--model", "{model}", "{request}"]);
    expect(
      located !== null && "command" in located && located.command[0],
    ).toContain("recognizer-describe-fake");

    let checked = "";

    await run(["sensors", "check", "--json", "--repository", repo], {
      ...io,
      stdout: (text: string) => {
        checked += text;
      },
    });

    expect(
      (JSON.parse(checked) as { sensors: { name: string }[] }).sensors.map(
        (one) => one.name,
      ),
    ).toEqual(["mine"]);

    const report = await doctor(repo, bin);
    const sensors = report.areas.find((area) => area.name === "sensors");

    expect(sensors?.problems.map((one) => one.subject)).toEqual(["mine"]);
    expect(JSON.stringify(report)).not.toContain("config line for mine");
  });

  it("the config still validates with those keys", () => {
    expect(() => parseConfig(OTHER_CONFIG)).not.toThrow();
  });

  it("reads this repository's own config without consulting its registrations", async () => {
    const repo = tempDirectory("recognizer-own-config-");
    const bin = tempDirectory("recognizer-own-bin-");

    mkdirSync(join(repo, ".recognizer"), { recursive: true });
    copyFileSync(
      join(REPO, ".recognizer", "config.yaml"),
      join(repo, ".recognizer", "config.yaml"),
    );

    for (const name of ["crap", "mutation"]) {
      writeShim(bin, `recognizer-sense-${name}`, manifestFor("sensor", name));
    }

    writeShim(
      bin,
      "recognizer-describe-fake",
      manifestFor("describer", "fake", { prompt_version: "registry-version" }),
    );

    const io = ioWithRegistry([bin]);

    expect(sensorsInEffect(manifestPorts(io)).map((one) => one.name)).toEqual([
      "crap",
      "mutation",
    ]);
    expect(describerInEffect(manifestPorts(io))).toMatchObject({
      version: "registry-version",
    });
    expect(readConfig(io, repo, ["describer"])?.describer?.build).toEqual({
      command: ["npm", "run", "build"],
      directory: "packages/describers/claude",
    });

    const report = await doctor(repo, bin);
    const config = report.areas.find((area) => area.name === "config");

    expect(
      (config?.problems ?? []).filter((one) => one.code === "config-yaml"),
    ).toEqual([]);
  });
});
