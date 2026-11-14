import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  commandRefusal,
  parseProposal,
  quoteCommand,
  SETUP_SCHEMA,
} from "../src/setup-proposal.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const commands = JSON.parse(
  readFileSync(join(root, "fixtures/setup/commands.json"), "utf8"),
) as {
  accepted: string[][];
  refused: { argv: string[]; reason: string }[];
};

function parsed(value: unknown) {
  const result = parseProposal(value);

  if ("error" in result) {
    throw new Error(result.error);
  }

  return result;
}

function change(section: string, command: string[]) {
  return {
    section,
    title: command.join(" "),
    reason: "r",
    commands: [command],
  };
}

describe("setup command grammar", () => {
  it("accepts every accepted entry and refuses every refused one with its reason", () => {
    expect(commands.accepted.length).toBeGreaterThan(0);
    expect(commands.refused.length).toBeGreaterThan(0);

    for (const argv of commands.accepted) {
      expect(commandRefusal(argv), argv.join(" ")).toBeNull();
    }

    for (const { argv, reason } of commands.refused) {
      expect(commandRefusal(argv), argv.join(" ").slice(0, 80)).toBe(reason);
    }
  });
});

describe("parseProposal", () => {
  const example = JSON.parse(
    readFileSync(
      join(root, "schema/setup-proposal-examples/valid-basic.json"),
      "utf8",
    ),
  );

  it("keeps an accepted change and reports a refused one with its title and reason", () => {
    const result = parsed({
      changes: [
        change("problems", ["recognizer", "config", "--unset", "a.b"]),
        {
          section: "tests",
          title: "Bad one",
          reason: "r",
          commands: [["recognizer", "scan", "--describe"]],
        },
      ],
    });

    expect(result.changes).toHaveLength(1);
    expect(result.dropped).toEqual([
      { title: "Bad one", refusal: "scan takes no argument" },
    ]);
  });

  it("yields zero changes and the dropped list when every change is refused", () => {
    const result = parsed({
      changes: [change("tests", ["npm", "test"])],
    });

    expect(result.changes).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
  });

  it("refuses a document of the wrong shape", () => {
    expect(parseProposal([])).toHaveProperty("error");
    expect(parseProposal({})).toHaveProperty("error");
    expect(parseProposal({ changes: [{ section: "x" }] })).toHaveProperty(
      "error",
    );
  });

  it("derives ticks from the commands", () => {
    const result = parsed(example);
    const bySection = (section: string) =>
      result.changes.find((one) => one.section === section);

    expect(result.changes).toHaveLength(3);
    expect(bySection("problems")?.ticked).toBe(true);
    expect(bySection("tests")?.ticked).toBe(false);
    expect(bySection("tests")?.runsTests).toBe(true);
    expect(bySection("policy")?.ticked).toBe(false);
  });

  it("badges a change that registers a program and leaves plugin add and other keys ticked", () => {
    const result = parsed({
      changes: [
        change("tests", [
          "recognizer",
          "config",
          "sensors.mine.command",
          "mine",
        ]),
        change("tests", [
          "recognizer",
          "config",
          "--add",
          "describer.command",
          "recognizer-describe-claude",
        ]),
        change("tests", ["recognizer", "plugin", "add", "claude"]),
        change("tests", [
          "recognizer",
          "config",
          "sensors.mine.max_minutes",
          "10",
        ]),
      ],
    });

    expect(result.changes).toHaveLength(4);
    expect(result.changes.map((one) => one.registersProgram)).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(result.changes.map((one) => one.ticked)).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });

  it("serialises the schema and parses the committed example", () => {
    const back = JSON.parse(JSON.stringify(SETUP_SCHEMA));

    expect(back.properties.changes.items.properties.section.enum).toEqual([
      "problems",
      "tests",
      "policy",
    ]);
    expect(parsed(example).changes).toHaveLength(3);
  });
});

describe("quoteCommand", () => {
  it("quotes an argument that needs it", () => {
    expect(quoteCommand(["recognizer", "config", "a b", "it's"])).toBe(
      "recognizer config 'a b' 'it'\\''s'",
    );
  });
});
