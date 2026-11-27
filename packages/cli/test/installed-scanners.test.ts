import {
  registrationFileName,
  serializeRegistration,
  setupReadsOver,
} from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { installedScanners } from "../src/adapters/plugins/installed-scanners.js";
import { ScannersAdapter } from "../src/adapters/plugins/scanners-adapter.js";
import { SurveyPluginsAdapter } from "../src/adapters/plugins/survey-plugins-adapter.js";
import { pluginPorts } from "../src/plugins-container.js";
import { installedLanguages } from "../src/published-languages.js";
import { runSetup } from "../src/setup-command.js";
import { cliScenario } from "./support/cli-scenario.js";
import { scannerManifestText } from "./support/manifest-text.js";

const FOLDER = "/plugins/user";

function world() {
  const scenario = cliScenario();
  const { io } = scenario.root;

  io.environment.RECOGNIZER_PLUGIN_DIRS = `/plugins/brew:${FOLDER}`;

  const manifestRuns = () =>
    io.processes.calls.filter((call) => call.args.join(" ") === "manifest")
      .length;

  const register = (name: string, healthy = true) => {
    const program = `recognizer-scan-${name}`;
    const command = [`/registered/${program}`];

    io.processes.register(program, (call) => ({
      started: true,
      status: healthy ? 0 : 1,
      stdout:
        healthy && call.args.join(" ") === "manifest"
          ? scannerManifestText(name)
          : "",
      stderr: healthy ? "" : "broken",
    }));
    io.files.writeFile(command[0] as string, "", 0o755);
    io.files.writeFile(
      `${FOLDER}/${registrationFileName("scanner", name)}`,
      serializeRegistration({
        kind: "scanner",
        name,
        command,
        manifest: [...command, "manifest"],
      }),
    );

    return command[0] as string;
  };

  return { io, manifestRuns, register };
}

describe("installed scanners cache", () => {
  it("a_second_read_of_the_same_registry_runs_no_manifest_command", () => {
    const { io, manifestRuns, register } = world();

    register("alpha");

    expect(installedScanners(io).plugins.map((p) => p.name)).toEqual(["alpha"]);

    const after = manifestRuns();

    expect(installedScanners(io).plugins.map((p) => p.name)).toEqual(["alpha"]);
    expect(after).toBeGreaterThan(0);
    expect(manifestRuns()).toBe(after);
  });

  it("registering_a_second_scanner_re_runs_discovery_and_lists_both", () => {
    const { io, manifestRuns, register } = world();

    register("alpha");
    installedScanners(io);

    const after = manifestRuns();

    register("beta");

    expect(
      installedScanners(io)
        .plugins.map((p) => p.name)
        .sort(),
    ).toEqual(["alpha", "beta"]);
    expect(manifestRuns()).toBeGreaterThan(after);
  });

  it("unregistering_a_scanner_drops_it_from_the_next_read", () => {
    const { io, register } = world();

    register("alpha");
    register("beta");
    expect(installedScanners(io).plugins).toHaveLength(2);

    io.files.remove(`${FOLDER}/${registrationFileName("scanner", "beta")}`);

    expect(installedScanners(io).plugins.map((p) => p.name)).toEqual(["alpha"]);
  });

  it("replacing_the_registered_launcher_in_place_re_reads_its_manifest", () => {
    const { io, manifestRuns, register } = world();
    const launcher = register("alpha");

    installedScanners(io);

    const after = manifestRuns();

    io.files.writeFile(launcher, "#!/bin/sh\nexit 0\n", 0o755);
    installedScanners(io);

    expect(manifestRuns()).toBeGreaterThan(after);
  });

  it("an_unreadable_manifest_is_not_held", () => {
    const { io, manifestRuns, register } = world();

    register("alpha", false);

    expect(installedScanners(io).unreadable).toHaveLength(1);

    const after = manifestRuns();

    register("alpha");
    io.files.writeFile(`${FOLDER}/other.txt`, "x");

    expect(installedScanners(io).unreadable).toHaveLength(0);
    expect(manifestRuns()).toBeGreaterThan(after);
  });

  it("with_no_scanner_registered_nothing_is_held", () => {
    const { io } = world();
    const listed = () => io.processes.calls.length;

    installedScanners(io);

    const first = listed();

    installedScanners(io);

    expect(listed()).toBeGreaterThan(first);
  });

  it("a_registry_with_one_good_and_one_unreadable_scanner_returns_the_good_one_and_reports_the_other", () => {
    const { io, manifestRuns, register } = world();

    register("good");
    register("bad", false);

    const found = installedScanners(io);

    expect(found.plugins.map((p) => p.name)).toEqual(["good"]);
    expect(found.unreadable.map((u) => u.command)).toEqual([
      expect.stringContaining("recognizer-scan-bad"),
    ]);

    const after = manifestRuns();

    installedScanners(io);

    expect(manifestRuns()).toBeGreaterThan(after);
  });

  it("scanners_adapter_discover_shares_the_cache", () => {
    const { io, manifestRuns, register } = world();

    register("alpha");
    installedScanners(io);

    const after = manifestRuns();

    expect(new ScannersAdapter(io).discover()).toEqual({ installed: 1 });
    expect(manifestRuns()).toBe(after);
  });

  it("installedLanguages_shares_the_cache", () => {
    const { io, manifestRuns, register } = world();

    register("alpha");
    installedScanners(io);

    const after = manifestRuns();

    expect(installedLanguages(io).rules().length).toBeGreaterThan(0);
    expect(manifestRuns()).toBe(after);
  });

  it("setup_command_scans_shares_the_cache", async () => {
    const { io, manifestRuns, register } = world();

    register("alpha");
    installedScanners(io);

    const after = manifestRuns();

    io.files.writeFile("/input.json", JSON.stringify({ entries: [] }));

    expect(
      await runSetup(["recommend", "/repo", "--input", "/input.json"], io),
    ).toBe(0);
    expect(manifestRuns()).toBe(after);
  });

  it("survey_answers_shares_the_cache", async () => {
    const { io, manifestRuns, register } = world();

    register("alpha");
    installedScanners(io);

    const after = manifestRuns();

    await new SurveyPluginsAdapter(io).answers({
      root: "/repo",
      files: [],
      suites: [],
    });

    expect(manifestRuns()).toBe(after);
  });

  it("setup_reads_language_rules_shares_the_cache", () => {
    const { io, manifestRuns, register } = world();

    register("alpha");
    installedScanners(io);

    const after = manifestRuns();
    const reads = setupReadsOver({
      plugins: pluginPorts(io),
      scanners: new ScannersAdapter(io),
    });

    expect(reads.languageRules().length).toBeGreaterThan(0);
    expect(manifestRuns()).toBe(after);
  });
});
