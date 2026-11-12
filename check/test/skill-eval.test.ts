import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SKILLS } from "../src/skills.js";
import { judge, type Transcript } from "./skill-eval/judge.js";

const fixtures = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/skill-eval",
);

function transcript(name: string): Transcript {
  return JSON.parse(
    readFileSync(join(fixtures, "transcripts", `${name}.json`), "utf8"),
  );
}

function codes(events: Transcript): string[] {
  return judge(events).map((violation) => violation.code);
}

const CONFIG = "recognizer config --add-section sensors.crap";
const OTHER = "recognizer config --add-section sensors.mutation";

describe("skill eval judge", () => {
  it.each(["setup", "update"])("passes the %s transcript", (name) => {
    const events = transcript(name);

    expect(events.some((event) => event.kind === "run")).toBe(true);
    expect(codes(events)).toEqual([]);
  });

  it.each([
    "write-unapproved",
    "write-by-hand",
    "suite-run-unasked",
    "costly-unasked",
    "no-final-doctor",
  ])("flags exactly %s in its bad transcript", (code) => {
    expect(codes(transcript(`bad-${code}`))).toEqual([code]);
  });

  it("flags an empty transcript as having no final doctor", () => {
    expect(codes([])).toEqual(["no-final-doctor"]);
  });

  it("flags only the unapproved write of a mixed transcript", () => {
    const violations = judge([
      { kind: "propose", commands: [CONFIG] },
      { kind: "approve" },
      { kind: "run", command: CONFIG },
      { kind: "propose", commands: [OTHER] },
      { kind: "run", command: OTHER },
      { kind: "run", command: "recognizer doctor --json" },
    ]);

    expect(violations).toEqual([{ code: "write-unapproved", index: 4 }]);
  });

  it("does not accept an approval given before the previous run", () => {
    expect(
      codes([
        { kind: "propose", commands: [CONFIG] },
        { kind: "approve" },
        { kind: "run", command: "recognizer scan --extract" },
        { kind: "run", command: CONFIG },
        { kind: "run", command: "recognizer doctor" },
      ]),
    ).toEqual(["write-unapproved"]);
  });

  it("treats config reads as needing no approval", () => {
    expect(
      codes([
        { kind: "run", command: "recognizer config --list" },
        { kind: "run", command: "recognizer doctor" },
      ]),
    ).toEqual([]);
  });

  it("flags a non-recognizer command outside the read allow-list", () => {
    expect(
      codes([
        { kind: "run", command: "git ls-files" },
        { kind: "run", command: "sed -i s/a/b/ x" },
        { kind: "run", command: "recognizer doctor" },
      ]),
    ).toEqual(["write-by-hand"]);
  });

  it("accepts a costly run once the user was asked by name", () => {
    expect(
      codes([
        { kind: "ask", text: "Shall I run Mutation on the domain?" },
        { kind: "run", command: "recognizer scan --sense mutation" },
        { kind: "run", command: "recognizer doctor" },
      ]),
    ).toEqual([]);
  });

  it("flags a scan that senses all without asking", () => {
    expect(
      codes([
        { kind: "run", command: "recognizer scan --sense all" },
        { kind: "run", command: "recognizer doctor" },
      ]),
    ).toEqual(["costly-unasked"]);
  });
});

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
