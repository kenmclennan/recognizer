import { describe, expect, it } from "vitest";
import { agentGuide } from "../src/agent-guide.js";
import { run } from "../src/cli.js";
import { COMMANDS } from "../src/commands.js";
import { shortHelp } from "../src/help.js";
import { fakeIo } from "./scan-helpers.js";

describe("agent guide", () => {
  it("is what help agents prints", () => {
    const fake = fakeIo();

    expect(run(["help", "agents"], fake.io)).toBe(0);
    expect(fake.out()).toBe(agentGuide());
  });

  it("says .recognizer/ is never touched and check --scan is not for agents", () => {
    const guide = agentGuide();

    expect(guide).toMatch(/Never[^\n]*\.recognizer\//);
    expect(guide).toMatch(/check --scan[^\n]*CI and fixtures/);
  });

  it("names --repository, direct-only rules and describe for a missing responsibility", () => {
    const guide = agentGuide();

    expect(guide).toMatch(/--repository <dir>/);
    expect(guide).toMatch(/--uses and --used-by[^\n]*direct[^\n]*only/);
    expect(guide).toMatch(/\[missing\][^\n]*recognizer describe/);
  });

  it("is pointed at by the short help", () => {
    expect(shortHelp()).toContain(
      "run `recognizer help agents` for the guide an agent follows",
    );
  });

  it("has a line for every command in the table", () => {
    expect(COMMANDS).toHaveLength(18);

    for (const command of COMMANDS) {
      expect(agentGuide()).toContain(
        `recognizer ${command.name} - ${command.summary}`,
      );
    }
  });

  it("names only commands that are in the table", () => {
    const names = new Set(COMMANDS.map((command) => command.name));
    const words = [...agentGuide().matchAll(/recognizer ([a-z][a-z-]*)/g)].map(
      (match) => match[1] as string,
    );

    expect(words.filter((word) => !names.has(word))).toEqual([]);
  });

  it("generates its command section from the table it is given", () => {
    const only = {
      ...(COMMANDS[0] as (typeof COMMANDS)[number]),
      name: "solo",
      summary: "the only one",
    };
    const lines = agentGuide([only])
      .split("\n")
      .filter((line) => line.endsWith(" - the only one"));

    expect(lines).toEqual(["recognizer solo - the only one"]);
    expect(agentGuide([only])).not.toContain("recognizer check - ");
  });
});
