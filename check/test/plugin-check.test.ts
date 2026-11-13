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
