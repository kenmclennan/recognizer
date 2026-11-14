import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Io, type RunOptions, run } from "../src/cli.js";
import {
  checkLimits,
  type PluginCheckResult,
  pluginCheck,
  stopResult,
} from "../src/plugin-check.js";
import type { Manifest } from "../src/plugin-manifest.js";
import { capture, REPO } from "./helpers.js";

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
      "ok    limits",
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
    expect(json.results).toHaveLength(13);
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
    expect(entry?.reason).toContain("protocol 2");
    expect(entry?.reason).toContain("protocol 1");
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
      2,
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

describe("checkLimits", () => {
  const thresholds = () =>
    JSON.parse(
      readFileSync(
        join(REPO, "schema/manifest-examples/valid/sensor-thresholds.json"),
        "utf8",
      ),
    ) as Manifest;
  const limitsOf = (manifest: Manifest) =>
    checkLimits({
      command: "x",
      current: 1,
      run: { started: true, status: 0, stdout: "", stderr: "" },
      leftovers: [],
      document: manifest,
      parsed: true,
      manifest,
    } as never);
  const edited = (change: (manifest: Manifest) => void) => {
    const manifest = thresholds();

    change(manifest);

    return limitsOf(manifest);
  };
  const first = (manifest: Manifest) =>
    manifest.settings[1] as {
      limit: { metric: string; severity?: string };
      labels?: unknown;
      key: string;
    };

  it("passes the thresholds manifest", () => {
    expect(limitsOf(thresholds())).toEqual({ name: "limits", status: "ok" });
  });

  it("fails a limit on a non-sensor", () => {
    const manifest = JSON.parse(
      readFileSync(
        join(REPO, "schema/manifest-examples/valid/scanner.json"),
        "utf8",
      ),
    ) as Manifest;

    manifest.settings = [
      {
        key: "k",
        type: "number",
        description: "d",
        example: "e",
        limit: { metric: "x", direction: "above" },
      },
    ];

    expect(limitsOf(manifest).reason).toContain("only a sensor");
  });

  it("fails a concrete metric that is not a metric of the manifest", () => {
    const outcome = edited((manifest) => {
      first(manifest).limit.metric = "nope";
    });

    expect(outcome.status).toBe("fail");
    expect(outcome.reason).toContain("nope is not a metric");
  });

  it("fails a placeholder metric that is not the key's own placeholder", () => {
    const outcome = edited((manifest) => {
      first(manifest).limit.metric = "<other>";
    });

    expect(outcome.reason).toContain("not the key's own placeholder");
  });

  it("fails a severity that does not name an enum setting", () => {
    const outcome = edited((manifest) => {
      first(manifest).limit.severity = "<metric>.above";
    });

    expect(outcome.reason).toContain("not an enum setting");
  });

  it("fails labels on a key with no placeholder", () => {
    const outcome = edited((manifest) => {
      manifest.settings.push({
        key: "plain",
        type: "number",
        description: "d",
        example: "e",
        labels: { a: "A" },
      });
    });

    expect(outcome.reason).toContain(
      "plain: labels needs a key with a placeholder",
    );
  });
});
