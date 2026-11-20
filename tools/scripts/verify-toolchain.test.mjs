import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMMAND_LINKS } from "./build-toolchain.mjs";
import { makeTempDir } from "./temp-dirs.mjs";
import { verifyCommands } from "./verify-toolchain.mjs";

describe("verifyCommands", () => {
  it("checks the one command the CLI-only toolchain holds", () => {
    expect(COMMAND_LINKS.map(([name]) => name)).toEqual(["recognizer"]);
  });

  it("names a missing recognizer entry", () => {
    const dir = makeTempDir("verify-toolchain-");

    mkdirSync(join(dir, "commands"));

    expect(() => verifyCommands(dir)).toThrow(
      "toolchain commands are wrong: recognizer is missing or not executable",
    );
  });

  it("passes when recognizer resolves to an executable inside the folder", () => {
    const dir = makeTempDir("verify-toolchain-ok-");
    const real = join(dir, "node_modules/recognizer/dist");

    mkdirSync(real, { recursive: true });
    writeFileSync(join(real, "bin.js"), "#!/bin/sh\n");
    chmodSync(join(real, "bin.js"), 0o755);
    mkdirSync(join(dir, "commands"));
    writeFileSync(join(dir, "commands/recognizer"), "#!/bin/sh\n");
    chmodSync(join(dir, "commands/recognizer"), 0o755);

    expect(() => verifyCommands(dir)).not.toThrow();
  });
});
