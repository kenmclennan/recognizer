import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SKILLS } from "../src/skills.js";

const fixtures = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/skill-eval",
);

describe("skill texts", () => {
  it("keeps the guide skill text unchanged and first", () => {
    expect(SKILLS[0]?.folder).toBe("recognizer");
    expect(SKILLS[0]?.text).toBe(
      [
        "---",
        "name: recognizer",
        "description: Use when the user asks about the structure of a codebase scanned with Recognizer, such as showing, explaining or extending a view of its modules.",
        "---",
        "",
        "Run `recognizer help agents` and follow it.",
        "",
      ].join("\n"),
    );
  });

  it("holds what the setup skill must say", () => {
    const text = SKILLS[1]?.text ?? "";

    expect(SKILLS[1]?.folder).toBe("recognizer-setup");

    for (const needle of [
      "name: recognizer-setup",
      "recognizer help agents",
      "recognizer scan --extract",
      "recognizer sensors check --run",
      "recognizer policy",
      "recognizer config",
      "recognizer doctor",
      "only after the user says yes",
    ]) {
      expect(text).toContain(needle);
    }
  });
});

describe("skill eval fixture repository", () => {
  it("holds the pytest section the skill reads", () => {
    expect(
      readFileSync(join(fixtures, "repo/pyproject.toml"), "utf8"),
    ).toContain("[tool.pytest.ini_options]");
  });
});
