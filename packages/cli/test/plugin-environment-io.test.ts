import { afterEach, describe, expect, it } from "vitest";
import { nodeIo } from "../src/cli.js";

const FOLDER = "/t/commands";
const saved = {
  PATH: process.env.PATH,
  RECOGNIZER_TOOLCHAIN_COMMANDS: process.env.RECOGNIZER_TOOLCHAIN_COMMANDS,
};

function restore(name: keyof typeof saved): void {
  const value = saved[name];

  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

afterEach(() => {
  restore("PATH");
  restore("RECOGNIZER_TOOLCHAIN_COMMANDS");
});

describe("nodeIo plugin environment", () => {
  it("runs a command with the toolchain folder first on PATH", () => {
    process.env.PATH = "/usr/bin:/bin";
    process.env.RECOGNIZER_TOOLCHAIN_COMMANDS = FOLDER;

    const io = nodeIo();
    const result = io.run("/bin/sh", ["-c", 'printf %s "$PATH"']);

    expect(result.stdout.startsWith(`${FOLDER}:`)).toBe(true);
    expect(io.env("PATH")).toBe(`${FOLDER}:/usr/bin:/bin`);
  });

  it("hides the handoff variable from the command", () => {
    process.env.PATH = "/usr/bin:/bin";
    process.env.RECOGNIZER_TOOLCHAIN_COMMANDS = FOLDER;

    const result = nodeIo().run("/bin/sh", [
      "-c",
      'printf %s "${RECOGNIZER_TOOLCHAIN_COMMANDS-unset}"',
    ]);

    expect(result.stdout).toBe("unset");
  });

  it("leaves the environment alone when the variable is unset", () => {
    process.env.PATH = "/usr/bin:/bin";
    delete process.env.RECOGNIZER_TOOLCHAIN_COMMANDS;

    const result = nodeIo().run("/bin/sh", ["-c", 'printf %s "$PATH"']);

    expect(result.stdout).toBe("/usr/bin:/bin");
  });
});
