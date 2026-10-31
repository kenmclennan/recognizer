import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { COMMANDS } from "../src/commands.js";
import { fullHelp, shortHelp } from "../src/help.js";
import { fakeIo } from "./scan-helpers.js";

function call(argv: string[]) {
  const fake = fakeIo();
  const code = run(argv, fake.io);

  return { code, out: fake.out(), err: fake.err() };
}

describe("command table", () => {
  it.each(COMMANDS.map((command) => [command.name, command] as const))(
    "%s has a full help entry",
    (_, command) => {
      expect(command.summary).not.toBe("");
      expect(command.usage).not.toBe("");
      expect(command.output.text).not.toBe("");
      expect(command.output.json).not.toBe("");
      expect(command.exitCodes.length).toBeGreaterThan(0);
      expect(command.examples.length).toBeGreaterThan(0);

      const help = fullHelp(command);

      expect(help).toContain(command.summary);

      for (const line of [
        ...command.usage.split("\n"),
        ...command.output.text.split("\n"),
        ...command.output.json.split("\n"),
      ]) {
        expect(help).toContain(line);
      }

      for (const entry of [
        ...command.arguments.map((a) => a.description),
        ...command.options.map((o) => o.flag),
        ...command.exitCodes.map((e) => e.meaning),
        ...command.examples.map((e) => e.command),
      ]) {
        expect(help).toContain(entry);
      }
    },
  );

  it("lists every command once, in table order, in the short help", () => {
    const lines = shortHelp().split("\n");
    const listed = lines
      .filter((line) => line.startsWith("  "))
      .map((line) => line.trim().split(/\s+/)[0]);

    expect(listed).toEqual(COMMANDS.map((command) => command.name));
  });

  it("holds the commands the CLI offers", () => {
    expect(COMMANDS.map((command) => command.name)).toEqual([
      "check",
      "scan",
      "open",
      "uses",
      "used-by",
      "callers",
      "path",
      "find",
      "show",
      "modules",
      "views",
      "windows",
      "window",
      "describe",
      "measure",
      "sense",
      "agents",
      "help",
    ]);
  });

  it.each(
    COMMANDS.map((command) => command.name).filter((name) => name !== "agents"),
  )("%s: help <name> and <name> --help print the table's entry", (name) => {
    const command = COMMANDS.find((entry) => entry.name === name);
    const expected = fullHelp(command as (typeof COMMANDS)[number]);

    expect(call(["help", name])).toEqual({ code: 0, out: expected, err: "" });
    expect(call([name, "--help"])).toEqual({
      code: 0,
      out: expected,
      err: "",
    });
    expect(call([name, "-h"]).out).toBe(expected);
  });

  it("agents --help prints the table's entry", () => {
    const command = COMMANDS.find((entry) => entry.name === "agents");
    const expected = fullHelp(command as (typeof COMMANDS)[number]);

    expect(call(["agents", "--help"])).toEqual({
      code: 0,
      out: expected,
      err: "",
    });
  });

  it.each(COMMANDS.map((command) => command.name))(
    "%s: dispatch reaches the table's run",
    (name) => {
      const command = COMMANDS.find((entry) => entry.name === name);
      const original = (command as (typeof COMMANDS)[number]).run;
      const seen: string[][] = [];

      (command as (typeof COMMANDS)[number]).run = (argv) => {
        seen.push(argv);

        return 7;
      };

      try {
        expect(call([name, "x", "y"]).code).toBe(7);
        expect(seen).toEqual([["x", "y"]]);
      } finally {
        (command as (typeof COMMANDS)[number]).run = original;
      }
    },
  );

  it("prints the short help and exits 0 for --help", () => {
    expect(call(["--help"])).toEqual({ code: 0, out: shortHelp(), err: "" });
  });

  it("prints the short help on stderr and exits 2 with no arguments", () => {
    expect(call([])).toEqual({ code: 2, out: "", err: shortHelp() });
  });

  it("lists every command for help with no name", () => {
    expect(call(["help"]).out).toBe(shortHelp());
  });

  it("exits 2 for help of an unknown command", () => {
    const result = call(["help", "nope"]);

    expect(result.code).toBe(2);
    expect(result.err).toContain("no such command: nope");
  });

  it("exits 2 with the short help for an unknown word", () => {
    const result = call(["frobnicate"]);

    expect(result.code).toBe(2);
    expect(result.err).toBe(shortHelp());
  });
});
