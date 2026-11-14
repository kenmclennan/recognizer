import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "./temp-dirs.mjs";
import { findUnit, loadUnits } from "./units.mjs";
import { pluginCommands, verifyBin, verifyPlugins } from "./verify-plugin.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const UNITS = loadUnits(ROOT);
const sensors = findUnit(UNITS, "sensors");

function fakeRecognizer(failing = [], message = "") {
  const dir = makeTempDir("verify-plugin-");
  const path = join(dir, "recognizer");

  writeFileSync(
    path,
    [
      "#!/bin/sh",
      'case "$1 $2" in "plugin check") ;; *) exit 9 ;; esac',
      `case "$(basename "$3")" in ${failing.map((name) => `${name}) echo "${message}" >&2; exit 1 ;;`).join(" ")} esac`,
      "exit 0",
      "",
    ].join("\n"),
  );
  chmodSync(path, 0o755);

  return [path];
}

describe("verifyPlugins", () => {
  it("runs plugin check on a unit's commands and not on recognizer", () => {
    expect(pluginCommands(sensors)).toEqual([
      "recognizer-sense-crap",
      "recognizer-sense-mutation",
      "recognizer-sense-thresholds",
    ]);
    expect(pluginCommands(findUnit(UNITS, "scan-rust"))).toEqual([
      "recognizer-scan-rust",
    ]);
  });

  it("passes when every command conforms", () => {
    expect(() => verifyPlugins("/x", sensors, fakeRecognizer())).not.toThrow();
  });

  it("fails naming each command that does not conform", () => {
    expect(() =>
      verifyPlugins(
        "/x",
        sensors,
        fakeRecognizer([
          "recognizer-sense-thresholds",
          "recognizer-sense-crap",
        ]),
      ),
    ).toThrow(
      "plugin check failed for: recognizer-sense-crap, recognizer-sense-thresholds",
    );
  });

  it("prints the output of each failing plugin check", () => {
    expect(() =>
      verifyPlugins(
        "/x",
        sensors,
        fakeRecognizer(["recognizer-sense-mutation"], "grammar missing"),
      ),
    ).toThrow("--- recognizer-sense-mutation\ngrammar missing");
  });
});

describe("verifyBin", () => {
  it("names a command the archive lacks", () => {
    const dir = makeTempDir("verify-bin-");

    mkdirSync(join(dir, "bin"));
    writeFileSync(join(dir, "bin/recognizer-sense-crap"), "#!/bin/sh\n");
    chmodSync(join(dir, "bin/recognizer-sense-crap"), 0o755);

    expect(() => verifyBin(dir, sensors)).toThrow(
      /recognizer-sense-mutation is missing or not executable, recognizer-sense-thresholds is missing or not executable/,
    );
  });
});
