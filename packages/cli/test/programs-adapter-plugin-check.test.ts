import { join } from "node:path";
import {
  pluginCheck as checkPlugin,
  type Manifest,
  type PluginCheckOptions,
  type PluginCheckResult,
  stopResult as stopPlugin,
} from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { type Io, type RunOptions, run } from "../src/cli.js";
import { pluginPorts } from "../src/plugins-container.js";
import { capture, REPO } from "./helpers.js";

const pluginCheck = (
  io: Io,
  command: string,
  current?: number,
  options?: PluginCheckOptions,
) => checkPlugin(pluginPorts(io), command, current, options);

const stopResult = (
  io: Io,
  command: string,
  manifest: Manifest,
  workspace: Parameters<typeof stopPlugin>[3],
  options: PluginCheckOptions,
) => stopPlugin(pluginPorts(io), command, manifest, workspace, options);

const FIXTURES = join(REPO, "fixtures/plugins");

const NEW_RESULTS = ["check-verb", "guide-verb", "run-verb", "events", "stop"];

async function check(name: string, ...extra: string[]) {
  const captured = capture();
  const status = await run(
    ["plugin", "check", join(FIXTURES, name), ...extra],
    captured.io,
  );

  return { status, out: captured.out(), err: captured.err() };
}

async function results(name: string): Promise<PluginCheckResult[]> {
  const json = JSON.parse((await check(name, "--json")).out) as {
    results: PluginCheckResult[];
  };

  return json.results;
}

async function failed(name: string): Promise<string[]> {
  return (await results(name))
    .filter((entry) => entry.status === "fail")
    .map((entry) => entry.name);
}

async function statusOf(
  name: string,
  result: string,
  options?: { graceMs: number },
): Promise<PluginCheckResult | undefined> {
  const report = await pluginCheck(
    capture().io,
    join(FIXTURES, name, "recognizer-scan-conforming"),
    undefined,
    options,
  );

  return report.results.find((entry) => entry.name === result);
}

describe("recognizer plugin check", () => {
  it("passes a conforming plugin with every result ok and exit 0", async () => {
    const outcome = await check("conforming/recognizer-scan-conforming");

    expect(outcome.status).toBe(0);
    expect(outcome.out.trimEnd().split("\n")).toEqual([
      "ok    starts",
      "ok    clean-output",
      "ok    valid",
      "ok    named-for-command",
      "ok    protocol",
      "ok    side-effect-free",
      "ok    sentences",
      "ok    placeholders",
      "ok    limits",
      "ok    grammars",
      "ok    check-verb  declares no check",
      "ok    guide-verb",
      "ok    run-verb",
      "ok    events",
      "ok    stop",
    ]);
  });

  it("prints the command, manifest and results with --json", async () => {
    const json = JSON.parse(
      (await check("conforming/recognizer-scan-conforming", "--json")).out,
    ) as { command: string; manifest: { name: string }; results: unknown[] };

    expect(json.command).toBe(
      join(FIXTURES, "conforming/recognizer-scan-conforming"),
    );
    expect(json.manifest.name).toBe("conforming");
    expect(json.results).toHaveLength(15);
  });

  it("fails starts for a command that exits 1", async () => {
    const outcome = await check("exits/recognizer-scan-conforming");

    expect(outcome.status).toBe(1);
    expect(await failed("exits/recognizer-scan-conforming")).toContain(
      "starts",
    );
    expect(outcome.out).toMatch(/fail {2}starts {2}manifest exited 1/);
  });

  it("fails only clean-output for a command that writes to stderr", async () => {
    expect(await failed("noisy/recognizer-scan-conforming")).toEqual([
      "clean-output",
    ]);
    expect((await check("noisy/recognizer-scan-conforming")).status).toBe(1);
  });

  it("fails only named-for-command for a command with the wrong basename", async () => {
    const entry = (await results("wrong-name/conforming-scanner")).find(
      (one) => one.status === "fail",
    );

    expect(await failed("wrong-name/conforming-scanner")).toEqual([
      "named-for-command",
    ]);
    expect(entry?.reason).toContain("recognizer-scan-conforming");
  });

  it("fails only protocol for a plugin on an unsupported protocol, naming plugin, both versions and install", async () => {
    const entry = (await results("future/recognizer-scan-conforming")).find(
      (one) => one.status === "fail",
    );

    expect(await failed("future/recognizer-scan-conforming")).toEqual([
      "protocol",
    ]);
    expect(entry?.reason).toContain("conforming");
    expect(entry?.reason).toContain("protocol 5");
    expect(entry?.reason).toContain("protocol 4");
    expect(entry?.reason).toContain("brew install --cask");
  });

  it("fails only side-effect-free for a command that writes a file into its working directory", async () => {
    const entry = (await results("writes/recognizer-scan-conforming")).find(
      (one) => one.status === "fail",
    );

    expect(await failed("writes/recognizer-scan-conforming")).toEqual([
      "side-effect-free",
    ]);
    expect(entry?.reason).toContain("leaked");
  });

  it("passes a plugin on the previous protocol with a warning that quotes install", async () => {
    const captured = capture();
    const report = await pluginCheck(
      captured.io,
      join(FIXTURES, "conforming/recognizer-scan-conforming"),
      5,
    );
    const warning = report.results.find((one) => one.status === "warn");

    expect(report.results.filter((one) => one.status === "fail")).toEqual([]);
    expect(warning?.name).toBe("protocol");
    expect(warning?.reason).toContain("brew install --cask");
  });

  it("exits 2 for no command, an unknown flag and a command not on PATH", async () => {
    const missing = capture();
    const flag = capture();
    const absent = capture();

    expect(await run(["plugin", "check"], missing.io)).toBe(2);
    expect(
      await run(
        [
          "plugin",
          "check",
          join(FIXTURES, "conforming/recognizer-scan-conforming"),
          "--x",
        ],
        flag.io,
      ),
    ).toBe(2);
    expect(
      await run(
        ["plugin", "check", "recognizer-scan-no-such-tool-here"],
        absent.io,
      ),
    ).toBe(2);
    expect(absent.err()).toContain("was not found on PATH");
  });

  it("appears in recognizer help", () => {
    const captured = capture();

    expect(run(["help", "plugin"], captured.io)).toBe(0);
    expect(captured.out()).toContain("recognizer plugin check <command>");
  });

  it.each([
    ["check-bad", "check-verb", /check document/],
    ["guide-stderr", "guide-verb", /stderr/],
    ["run-fails", "run-verb", /no diagnosis event/],
    ["event-invalid", "events", /not a valid event/],
    ["event-order", "events", /before any start/],
    ["event-over", "events", /2 done of 1/],
  ])("fails only %s's %s result", async (fixture, name, reason) => {
    const entries = await results(`${fixture}/recognizer-scan-conforming`);
    const bad = entries.filter((entry) => entry.status === "fail");

    expect(bad.map((entry) => entry.name)).toEqual([name]);
    expect(bad[0]?.reason).toMatch(reason);

    for (const other of NEW_RESULTS.filter((one) => one !== name)) {
      expect(entries.find((entry) => entry.name === other)?.status).toBe("ok");
    }
  });

  it.each([
    ["events_fails_a_stage_past_its_total", "stage-over", /index 4 of 3/],
    [
      "events_fails_a_stage_before_any_start",
      "stage-first",
      /stage event came before any start/,
    ],
    [
      "events_fails_an_invalid_estimate",
      "estimate-invalid",
      /not a valid event/,
    ],
  ])("%s", async (_title, fixture, reason) => {
    const events = await statusOf(fixture, "events");

    expect(events?.status).toBe("fail");
    expect(events?.reason).toMatch(reason);
  });

  it("events_passes_a_run_that_reports_stages_and_estimates", async () => {
    const events = await statusOf("stages-and-estimates", "events");

    expect(events?.status).toBe("ok");
  });

  it("fails stop for a plugin that ignores SIGTERM and kills it", async () => {
    const stop = await statusOf("ignores-term", "stop", { graceMs: 300 });

    expect(stop?.status).toBe("fail");
    expect(stop?.reason).toMatch(/did not exit within/);
  });

  it("warns on stop for a plugin that finishes before it could be stopped", async () => {
    const stop = await statusOf("finishes-early", "stop");

    expect(stop).toEqual({
      name: "stop",
      status: "warn",
      reason: "finished before it could be stopped",
    });
  });

  async function stopAfterCompleteDocument(progress: string[]) {
    const document = JSON.stringify({
      findings_version: 1,
      sensor: { name: "demo", version: "0.1.0" },
      commit: "abc",
      modified: false,
      inputs: {},
      settings: {},
      findings: [],
    });
    const io = {
      runAsync: (_command: string, _args: string[], options: RunOptions) => {
        queueMicrotask(() =>
          options.onStderrLine?.(
            'recognizer-event {"event":"start","total":2,"unit":"modules"}',
          ),
        );

        return {
          kill: () => {},
          result: Promise.resolve({
            started: true,
            status: null,
            stdout: "",
            stderr: [
              'recognizer-event {"event":"start","total":2,"unit":"modules"}',
              ...progress,
            ].join("\n"),
          }),
        };
      },
      exists: () => true,
      readFile: () => document,
    } as unknown as Io;
    const manifest = { kind: "sensor", name: "demo" } as Manifest;
    const workspace = {
      repository: "r",
      commit: "abc",
      output: "o",
      cleanup: () => {},
    };

    return stopResult(io, "demo", manifest, workspace, {});
  }

  it("warns on stop when the complete document follows progress that reached the start total", async () => {
    expect(
      await stopAfterCompleteDocument([
        'recognizer-event {"event":"progress","done":2,"total":2,"unit":"modules"}',
      ]),
    ).toEqual({
      name: "stop",
      status: "warn",
      reason: "finished before it could be stopped",
    });
  });

  it("fails on stop when the complete document follows progress short of the start total", async () => {
    expect(
      await stopAfterCompleteDocument([
        'recognizer-event {"event":"progress","done":1,"total":2,"unit":"modules"}',
      ]),
    ).toMatchObject({ name: "stop", status: "fail" });
  });

  it("fails the stop check of a describer whose manifest publishes no model", async () => {
    const io = { exists: () => false } as unknown as Io;
    const manifest = {
      kind: "describer",
      name: "d",
      settings: [],
    } as unknown as Manifest;
    const workspace = {
      repository: "r",
      commit: "abc",
      output: "o",
      cleanup: () => {},
    };

    expect(
      await stopResult(io, "d", manifest, workspace, {
        request: "request.json",
      }),
    ).toEqual({
      name: "stop",
      status: "fail",
      reason: "the manifest publishes no model default to check with",
    });
  });

  it("warns on run-verb and stop for a describer run without --request", async () => {
    const report = await pluginCheck(
      capture().io,
      join(FIXTURES, "describer/recognizer-describe-conforming"),
    );
    const named = (name: string) =>
      report.results.find((entry) => entry.name === name);

    expect(named("run-verb")?.reason).toBe("not run: pass --request");
    expect(named("stop")?.status).toBe("warn");
    expect(named("events")?.status).toBe("ok");
  });

  it("lists --repository and --request in plugin check's help", async () => {
    const captured = capture();

    expect(await run(["plugin", "--help"], captured.io)).toBe(0);
    expect(captured.out()).toContain("--repository <dir>");
    expect(captured.out()).toContain("--request <file>");
  });
});
