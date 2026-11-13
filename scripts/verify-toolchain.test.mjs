import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "./temp-dirs.mjs";
import { pluginCommands, verifyPlugins } from "./verify-toolchain.mjs";

function fakeToolchain(failing = [], message = "") {
  const dir = makeTempDir("verify-toolchain-");
  const commands = join(dir, "commands");

  mkdirSync(commands);
  writeFileSync(
    join(commands, "recognizer"),
    [
      "#!/bin/sh",
      'case "$1 $2" in "plugin check") ;; *) exit 9 ;; esac',
      `case "$(basename "$3")" in ${failing.map((name) => `${name}) echo "${message}" >&2; exit 1 ;;`).join(" ")} esac`,
      "exit 0",
      "",
    ].join("\n"),
  );
  chmodSync(join(commands, "recognizer"), 0o755);

  return dir;
}

describe("verifyPlugins", () => {
  it("runs plugin check on the nine plugin commands and not on recognizer or recognizer-sensors", () => {
    expect(pluginCommands().sort()).toEqual([
      "recognizer-describe-claude",
      "recognizer-scan-csharp",
      "recognizer-scan-kotlin",
      "recognizer-scan-python",
      "recognizer-scan-rust",
      "recognizer-scan-typescript",
      "recognizer-sense-crap",
      "recognizer-sense-mutation",
      "recognizer-sense-thresholds",
    ]);
  });

  it("passes when every command conforms", () => {
    expect(() => verifyPlugins(fakeToolchain())).not.toThrow();
  });

  it("fails naming each command that does not conform", () => {
    const dir = fakeToolchain([
      "recognizer-scan-rust",
      "recognizer-sense-crap",
    ]);

    expect(() => verifyPlugins(dir)).toThrow(
      "plugin check failed for: recognizer-sense-crap, recognizer-scan-rust",
    );
  });

  it("prints the output of each failing plugin check", () => {
    const dir = fakeToolchain(["recognizer-scan-kotlin"], "grammar missing");

    expect(() => verifyPlugins(dir)).toThrow(
      "--- recognizer-scan-kotlin\ngrammar missing",
    );
  });
});
