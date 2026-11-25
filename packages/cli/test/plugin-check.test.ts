import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkGrammars,
  checkLimits,
  checkPlaceholders,
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

const thresholds = () =>
  ({
    ...JSON.parse(
      readFileSync(
        join(REPO, "schema/manifest-examples/valid/sensor-crap.json"),
        "utf8",
      ),
    ),
    name: "mine",
    metrics: [],
    placeholders: {
      name: { pattern: "^.+$", description: "the name of a test suite" },
      variable: {
        pattern: "^[A-Za-z_][A-Za-z0-9_]*$",
        description: "the name of an environment variable",
      },
      metric: {
        pattern: "^[a-z][a-z0-9_-]*$",
        description: "a metric the sensor reports",
      },
    },
    settings: [
      {
        key: "<metric>",
        type: "enum",
        description: "turns the default threshold of a metric off",
        example: "sensors.mine.coverage off",
        values: ["off"],
      },
      {
        key: "<metric>.above",
        type: "number",
        description:
          "a finding when the metric is above this value; a metric takes above or below, not both",
        example: "sensors.mine.churn.above 20",
        order: 1,
        limit: {
          metric: "<metric>",
          direction: "above",
          severity: "<metric>.severity",
        },
      },
      {
        key: "<metric>.below",
        type: "number",
        description:
          "a finding when the metric is below this value; a metric takes above or below, not both",
        example: "sensors.mine.coverage.below 0.7",
        defaults: {
          coverage: 0.6,
        },
        labels: {
          coverage: "Coverage below",
        },
        units: {
          coverage: "0 to 1",
        },
        order: 2,
        limit: {
          metric: "<metric>",
          direction: "below",
          severity: "<metric>.severity",
        },
      },
      {
        key: "<metric>.severity",
        type: "enum",
        description: "how a finding of the metric is reported; default warning",
        example: "sensors.mine.coverage.severity violation",
        values: ["warning", "violation"],
        defaults: {
          coverage: "warning",
        },
      },
    ],
  }) as Manifest;

describe("checkGrammars", () => {
  const grammarsOf = (manifest: Manifest) =>
    checkGrammars({
      command: "x",
      current: 1,
      run: { started: true, status: 0, stdout: "", stderr: "" },
      leftovers: [],
      document: manifest,
      parsed: true,
      manifest,
    } as never);
  const scanner = () =>
    JSON.parse(
      readFileSync(
        join(REPO, "schema/manifest-examples/valid/scanner.json"),
        "utf8",
      ),
    ) as Manifest;
  const withGrammar = (grammar: Record<string, unknown>) => {
    const manifest = scanner();

    manifest.languages = [{ name: "acme", grammars: [grammar] }];

    return manifest;
  };

  it("fails a grammar with no vocabulary, naming the grammar", () => {
    const outcome = grammarsOf(withGrammar({ name: "acme-grammar" }));

    expect(outcome.status).toBe("fail");
    expect(outcome.reason).toContain("acme-grammar");
    expect(outcome.reason).toContain("no vocabulary");
  });

  it("passes a grammar that publishes a vocabulary", () => {
    expect(
      grammarsOf(
        withGrammar({ name: "acme-grammar", vocabulary: { fields: {} } }),
      ),
    ).toEqual({ name: "grammars", status: "ok" });
  });

  it("fails a grammar whose vocabulary has no fields key", () => {
    const outcome = grammarsOf(
      withGrammar({ name: "python", vocabulary: { comment_markers: ["x"] } }),
    );

    expect(outcome.status).toBe("fail");
    expect(outcome.reason).toContain("python");
    expect(outcome.reason).toContain("fields");
  });

  it("passes a grammar that publishes a fields role", () => {
    expect(
      grammarsOf(
        withGrammar({
          name: "python",
          vocabulary: { fields: { name: "name" } },
        }),
      ),
    ).toEqual({ name: "grammars", status: "ok" });
  });

  it("passes a grammar whose empty fields object declares no field carries a role", () => {
    expect(
      grammarsOf(withGrammar({ name: "kotlin", vocabulary: { fields: {} } })),
    ).toEqual({ name: "grammars", status: "ok" });
  });

  it("passes a manifest that publishes no grammars", () => {
    const manifest = scanner();

    manifest.languages = [{ name: "acme" }];

    expect(grammarsOf(manifest)).toEqual({ name: "grammars", status: "ok" });
  });
});

describe("checkLimits", () => {
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

describe("checkPlaceholders", () => {
  const placeholdersOf = (manifest: Manifest) =>
    checkPlaceholders({
      command: "x",
      current: 1,
      run: { started: true, status: 0, stdout: "", stderr: "" },
      leftovers: [],
      document: manifest,
      parsed: true,
      manifest,
    } as never);
  const declared = (manifest: Manifest) =>
    manifest.placeholders as Record<
      string,
      { pattern?: string; values?: string[]; description: string }
    >;
  const edited = (change: (manifest: Manifest) => void) => {
    const manifest = thresholds();

    change(manifest);

    return placeholdersOf(manifest);
  };

  it("passes the thresholds manifest with every placeholder declared and used", () => {
    expect(placeholdersOf(thresholds())).toEqual({
      name: "placeholders",
      status: "ok",
    });
  });

  it("fails a pattern that does not compile", () => {
    const outcome = edited((manifest) => {
      declared(manifest).metric = { pattern: "(", description: "broken" };
    });

    expect(outcome.status).toBe("fail");
    expect(outcome.reason).toContain("metric: pattern does not compile");
  });

  it("fails a placeholder a key uses that the manifest does not declare", () => {
    const outcome = edited((manifest) => {
      delete declared(manifest).metric;
    });

    expect(outcome.status).toBe("fail");
    expect(outcome.reason).toContain(
      "<metric>.above: uses the placeholder <metric> that the manifest does not declare",
    );
  });

  it("fails a declaration no key uses", () => {
    const outcome = edited((manifest) => {
      declared(manifest).unused = {
        values: ["a"],
        description: "nothing uses this",
      };

      expect(Object.keys(declared(manifest))).toContain("unused");
    });

    expect(outcome.status).toBe("fail");
    expect(outcome.reason).toContain("unused: declared but no key uses it");
  });

  it("fails a labels entry that does not match the declared pattern", () => {
    const outcome = edited((manifest) => {
      (manifest.settings[2] as { labels: Record<string, string> }).labels = {
        "Not A Metric": "Coverage below",
      };
    });

    expect(outcome.status).toBe("fail");
    expect(outcome.reason).toContain(
      "<metric>.below: labels entry Not A Metric does not match <metric>",
    );
  });

  it("passes a labels entry that matches the declared pattern", () => {
    const manifest = thresholds();

    expect(
      (manifest.settings[2] as { labels: Record<string, string> }).labels,
    ).toEqual({ coverage: "Coverage below" });
    expect(placeholdersOf(manifest)).toEqual({
      name: "placeholders",
      status: "ok",
    });
  });

  it("matches an entry against a values declaration exactly", () => {
    const outcome = edited((manifest) => {
      declared(manifest).metric = {
        values: ["churn"],
        description: "a metric the sensor reports",
      };
    });

    expect(outcome.reason).toContain(
      "<metric>.below: labels entry coverage does not match <metric>",
    );
  });
});
