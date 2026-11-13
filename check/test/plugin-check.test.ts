import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { type PluginCheckResult, pluginCheck } from "../src/plugin-check.js";
import { capture, REPO } from "./helpers.js";

const FIXTURES = join(REPO, "fixtures/plugins");

function check(name: string, ...extra: string[]) {
  const captured = capture();
  const status = run(
    ["plugin", "check", join(FIXTURES, name), ...extra],
    captured.io,
  );

  return { status, out: captured.out(), err: captured.err() };
}

function results(name: string): PluginCheckResult[] {
  const json = JSON.parse(check(name, "--json").out) as {
    results: PluginCheckResult[];
  };

  return json.results;
}

function failed(name: string): string[] {
  return results(name)
    .filter((entry) => entry.status === "fail")
    .map((entry) => entry.name);
}

describe("recognizer plugin check", () => {
  it("passes a conforming plugin with every result ok and exit 0", () => {
    const outcome = check("conforming/recognizer-scan-conforming");

    expect(outcome.status).toBe(0);
    expect(outcome.out.trimEnd().split("\n")).toEqual([
      "ok    starts",
      "ok    clean-output",
      "ok    valid",
      "ok    named-for-command",
      "ok    protocol",
      "ok    side-effect-free",
      "ok    sentences",
    ]);
  });

  it("prints the command, manifest and results with --json", () => {
    const json = JSON.parse(
      check("conforming/recognizer-scan-conforming", "--json").out,
    ) as { command: string; manifest: { name: string }; results: unknown[] };

    expect(json.command).toBe(
      join(FIXTURES, "conforming/recognizer-scan-conforming"),
    );
    expect(json.manifest.name).toBe("conforming");
    expect(json.results).toHaveLength(7);
  });

  it("fails starts for a command that exits 1", () => {
    const outcome = check("exits/recognizer-scan-conforming");

    expect(outcome.status).toBe(1);
    expect(failed("exits/recognizer-scan-conforming")).toContain("starts");
    expect(outcome.out).toMatch(/fail {2}starts {2}manifest exited 1/);
  });

  it("fails only clean-output for a command that writes to stderr", () => {
    expect(failed("noisy/recognizer-scan-conforming")).toEqual([
      "clean-output",
    ]);
    expect(check("noisy/recognizer-scan-conforming").status).toBe(1);
  });

  it("fails only named-for-command for a command with the wrong basename", () => {
    const entry = results("wrong-name/conforming-scanner").find(
      (one) => one.status === "fail",
    );

    expect(failed("wrong-name/conforming-scanner")).toEqual([
      "named-for-command",
    ]);
    expect(entry?.reason).toContain("recognizer-scan-conforming");
  });

  it("fails only protocol for a plugin on an unsupported protocol, naming plugin, both versions and install", () => {
    const entry = results("future/recognizer-scan-conforming").find(
      (one) => one.status === "fail",
    );

    expect(failed("future/recognizer-scan-conforming")).toEqual(["protocol"]);
    expect(entry?.reason).toContain("conforming");
    expect(entry?.reason).toContain("protocol 2");
    expect(entry?.reason).toContain("protocol 1");
    expect(entry?.reason).toContain("brew install --cask");
  });

  it("fails only side-effect-free for a command that writes a file into its working directory", () => {
    const entry = results("writes/recognizer-scan-conforming").find(
      (one) => one.status === "fail",
    );

    expect(failed("writes/recognizer-scan-conforming")).toEqual([
      "side-effect-free",
    ]);
    expect(entry?.reason).toContain("leaked");
  });

  it("passes a plugin on the previous protocol with a warning that quotes install", () => {
    const captured = capture();
    const report = pluginCheck(
      captured.io,
      join(FIXTURES, "conforming/recognizer-scan-conforming"),
      2,
    );
    const warning = report.results.find((one) => one.status === "warn");

    expect(report.results.filter((one) => one.status === "fail")).toEqual([]);
    expect(warning?.name).toBe("protocol");
    expect(warning?.reason).toContain("brew install --cask");
  });

  it("exits 2 for no command, an unknown flag and a command not on PATH", () => {
    const missing = capture();
    const flag = capture();
    const absent = capture();

    expect(run(["plugin", "check"], missing.io)).toBe(2);
    expect(
      run(
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
      run(["plugin", "check", "recognizer-scan-no-such-tool-here"], absent.io),
    ).toBe(2);
    expect(absent.err()).toContain("was not found on PATH");
  });

  it("appears in recognizer help", () => {
    const captured = capture();

    expect(run(["help", "plugin"], captured.io)).toBe(0);
    expect(captured.out()).toContain("recognizer plugin check <command>");
  });
});
