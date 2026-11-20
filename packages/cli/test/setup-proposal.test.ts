import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { commandRefusal, quoteCommand } from "../src/setup-proposal.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const commands = JSON.parse(
  readFileSync(join(root, "fixtures/setup/commands.json"), "utf8"),
) as {
  accepted: string[][];
  refused: { argv: string[]; reason: string }[];
};

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

describe("quoteCommand", () => {
  it("quotes an argument that needs it", () => {
    expect(quoteCommand(["recognizer", "config", "a b", "it's"])).toBe(
      "recognizer config 'a b' 'it'\\''s'",
    );
  });
});
