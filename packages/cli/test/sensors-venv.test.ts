import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import {
  requirePythonScannerVenv,
  requireSensorsVenv,
} from "./sensors-venv.js";

const COMMAND = "uv sync --locked --project packages/sensors";

function repoWith(...names: string[]): string {
  const root = makeTempDir("sensors-venv-");

  if (names.length > 0) {
    const bin = join(root, "packages/sensors/.venv/bin");

    mkdirSync(bin, { recursive: true });

    for (const name of names) {
      writeFileSync(join(bin, `recognizer-sense-${name}`), "");
    }
  }

  return root;
}

describe("requireSensorsVenv", () => {
  it("names every missing binary and the command when none exist", () => {
    expect(() => requireSensorsVenv(repoWith())).toThrow(
      /recognizer-sense-crap, recognizer-sense-mutation/,
    );
    expect(() => requireSensorsVenv(repoWith())).toThrow(COMMAND);
  });

  it("names only the missing binary when some exist", () => {
    const root = repoWith("crap");

    expect(() => requireSensorsVenv(root)).toThrow(/recognizer-sense-mutation/);
    expect(() => requireSensorsVenv(root)).not.toThrow(/recognizer-sense-crap/);
  });

  it("returns when every binary exists", () => {
    expect(() =>
      requireSensorsVenv(repoWith("crap", "mutation")),
    ).not.toThrow();
  });
});

describe("requirePythonScannerVenv", () => {
  it("names the scanner binary and the command when it is missing", () => {
    const root = makeTempDir("scanner-venv-");

    expect(() => requirePythonScannerVenv(root)).toThrow(
      /packages\/scanners\/python\/\.venv has no recognizer-scan-python/,
    );
    expect(() => requirePythonScannerVenv(root)).toThrow(
      "uv sync --locked --project packages/scanners/python",
    );
  });

  it("returns when the scanner binary exists", () => {
    const root = makeTempDir("scanner-venv-");
    const bin = join(root, "packages/scanners/python/.venv/bin");

    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "recognizer-scan-python"), "");

    expect(() => requirePythonScannerVenv(root)).not.toThrow();
  });
});
