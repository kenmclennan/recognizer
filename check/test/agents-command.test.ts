import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../scripts/temp-dirs.mjs";
import { nodeIo, run } from "../src/cli.js";
import { fakeIo } from "./scan-helpers.js";

const HOME = "/home/u";
const SETTINGS = `${HOME}/.claude/settings.json`;
const SKILL = `${HOME}/.claude/skills/recognizer/SKILL.md`;
const SETUP = `${HOME}/.claude/skills/recognizer-setup/SKILL.md`;
const READ = "Read(**/.recognizer/**)";
const EDIT = "Edit(**/.recognizer/**)";
const READ_EXCEPT = "Read(!**/.recognizer/config.yaml)";
const EDIT_EXCEPT = "Edit(!**/.recognizer/config.yaml)";
const FOUR = [READ, EDIT, READ_EXCEPT, EDIT_EXCEPT];

function setup(files: Record<string, string> = {}, env = { HOME }) {
  return fakeIo({ files, env });
}

function call(fake: ReturnType<typeof setup>, ...argv: string[]) {
  return run(["agents", ...argv], fake.io);
}

function settingsOf(fake: ReturnType<typeof setup>) {
  return JSON.parse(fake.files.get(SETTINGS) as string);
}

const EXISTING = {
  theme: "dark",
  permissions: { allow: ["Bash(ls)"], deny: ["Read(.env)"] },
};

describe("agents install", () => {
  it("writes the skill and exactly the four rules into an empty home", () => {
    const fake = setup();

    expect(call(fake, "install")).toBe(0);
    expect(fake.files.get(SKILL)).toContain("recognizer help agents");
    expect(settingsOf(fake).permissions.deny).toEqual(FOUR);
    expect(fake.out()).toBe(
      [
        `wrote ${SKILL}`,
        `wrote ${SETUP}`,
        ...FOUR.map((rule) => `added deny rule ${rule}`),
        "",
      ].join("\n"),
    );
  });

  it("merges into existing settings without losing other keys", () => {
    const fake = setup({ [SETTINGS]: JSON.stringify(EXISTING) });

    call(fake, "install");

    const settings = settingsOf(fake);

    expect(settings.theme).toBe("dark");
    expect(settings.permissions.allow).toEqual(["Bash(ls)"]);
    expect(settings.permissions.deny).toEqual(["Read(.env)", ...FOUR]);
  });

  it("is idempotent", () => {
    const fake = setup();

    call(fake, "install");

    const settings = fake.files.get(SETTINGS);
    const skill = fake.files.get(SKILL);
    const writes = fake.writes.length;
    const before = fake.out().length;

    expect(call(fake, "install")).toBe(0);
    expect(fake.out().slice(before)).toBe("no change\n");
    expect(fake.writes.length).toBe(writes);
    expect(fake.files.get(SETTINGS)).toBe(settings);
    expect(fake.files.get(SKILL)).toBe(skill);
  });

  it("adds only the missing rule", () => {
    const fake = setup({
      [SETTINGS]: JSON.stringify({ permissions: { deny: [READ] } }),
    });

    call(fake, "install");

    expect(fake.out()).toContain(`added deny rule ${EDIT}`);
    expect(fake.out()).not.toContain(`added deny rule ${READ}`);
    expect(settingsOf(fake).permissions.deny).toEqual(FOUR);
  });

  it("adds exactly one rule when only the Edit rule is present", () => {
    const fake = setup({
      [SETTINGS]: JSON.stringify({ permissions: { deny: [EDIT] } }),
      [SKILL]: "x",
    });

    call(fake, "install");

    expect(
      fake
        .out()
        .split("\n")
        .filter((line) => line.startsWith("added")),
    ).toEqual([
      `added deny rule ${READ}`,
      `added deny rule ${READ_EXCEPT}`,
      `added deny rule ${EDIT_EXCEPT}`,
    ]);
  });

  it("gains exactly the two negations after the two old rules", () => {
    const fake = setup({
      [SETTINGS]: JSON.stringify({ permissions: { deny: [READ, EDIT] } }),
      [SKILL]: "x",
    });

    call(fake, "install");

    expect(settingsOf(fake).permissions.deny).toEqual(FOUR);
    expect(
      fake
        .out()
        .split("\n")
        .filter((line) => line.startsWith("added")),
    ).toEqual([
      `added deny rule ${READ_EXCEPT}`,
      `added deny rule ${EDIT_EXCEPT}`,
    ]);
  });

  it("moves a negation listed before the rule it narrows to after it", () => {
    const fake = setup({
      [SETTINGS]: JSON.stringify({
        permissions: { deny: [READ_EXCEPT, READ, EDIT_EXCEPT, EDIT] },
      }),
      [SKILL]: "x",
    });

    call(fake, "install");

    expect(settingsOf(fake).permissions.deny).toEqual(FOUR);
    expect(fake.out()).toContain(`moved deny rule ${READ_EXCEPT}`);
  });

  it("adds only the second skill to a home holding the first", () => {
    const first = setup();

    call(first, "install");

    const fake = setup({
      [SETTINGS]: first.files.get(SETTINGS) as string,
      [SKILL]: first.files.get(SKILL) as string,
    });

    call(fake, "install");

    expect(fake.out()).toBe(`wrote ${SETUP}\n`);
    expect(fake.files.get(SETUP)).toContain("name: recognizer-setup");
  });

  it("reports a differing second skill as updated", () => {
    const fake = setup({ [SETUP]: "old" });

    call(fake, "install");

    expect(fake.out()).toContain(`updated ${SETUP}`);
    expect(fake.out()).not.toContain(`updated ${SKILL}`);
  });

  it("reports a differing skill as updated", () => {
    const fake = setup({ [SKILL]: "old" });

    call(fake, "install");

    expect(fake.out()).toContain(`updated ${SKILL}`);
    expect(fake.files.get(SKILL)).toContain("recognizer help agents");
  });

  it.each([
    ["not JSON", "{nope"],
    ["an array", "[]"],
    ["permissions a string", '{"permissions":"x"}'],
    ["deny an object", '{"permissions":{"deny":{}}}'],
  ])("refuses settings that are %s and writes nothing", (_, content) => {
    const fake = setup({ [SETTINGS]: content });

    expect(call(fake, "install")).toBe(2);
    expect(fake.err()).toContain(SETTINGS);
    expect(fake.files.get(SETTINGS)).toBe(content);
    expect(fake.files.has(SKILL)).toBe(false);
    expect(fake.writes).toEqual([]);
  });

  it.each(["install", "uninstall"])("%s exits 2 with no HOME", (verb) => {
    const fake = setup({}, {} as { HOME: string });

    expect(call(fake, verb)).toBe(2);
    expect(fake.err()).toContain("HOME");
  });

  it("prints changes as JSON", () => {
    const fake = setup();

    call(fake, "install", "--json");

    expect(JSON.parse(fake.out())).toEqual({
      changes: [
        `wrote ${SKILL}`,
        `wrote ${SETUP}`,
        ...FOUR.map((rule) => `added deny rule ${rule}`),
      ],
    });
  });

  it.each([[["bogus"]], [["install", "extra"]], [[]]])(
    "rejects arguments %j",
    (argv) => {
      expect(call(setup(), ...argv)).toBe(2);
    },
  );
});

describe("agents uninstall", () => {
  it("restores the original settings exactly", () => {
    const original = `${JSON.stringify(EXISTING, null, 2)}\n`;
    const fake = setup({ [SETTINGS]: original });

    call(fake, "install");

    expect(call(fake, "uninstall")).toBe(0);
    expect(fake.files.get(SETTINGS)).toBe(original);
    expect(fake.files.has(SKILL)).toBe(false);
  });

  it("removes the skill and its folder from an empty home", () => {
    const fake = setup();

    call(fake, "install");
    call(fake, "uninstall");

    expect(fake.files.has(SKILL)).toBe(false);
    expect(settingsOf(fake)).toEqual({});
    expect(fake.out()).toContain(`removed ${SKILL}`);
    expect(fake.out()).toContain(`removed deny rule ${READ}`);
  });

  it("removes both skills and keeps a folder that is not empty", () => {
    const fake = setup();

    call(fake, "install");
    fake.files.set(`${HOME}/.claude/skills/recognizer-setup/notes.md`, "x");
    call(fake, "uninstall");

    expect(fake.files.has(SKILL)).toBe(false);
    expect(fake.files.has(SETUP)).toBe(false);
    expect(
      fake.files.has(`${HOME}/.claude/skills/recognizer-setup/notes.md`),
    ).toBe(true);
  });

  it("removes only the first skill from a home that holds only it", () => {
    const fake = setup({ [SKILL]: "x" });

    call(fake, "uninstall");

    expect(fake.out()).toBe(`removed ${SKILL}\n`);
  });

  it("reports no change the second time and with nothing installed", () => {
    const fake = setup();

    call(fake, "install");
    call(fake, "uninstall");

    const before = fake.out().length;

    expect(call(fake, "uninstall")).toBe(0);
    expect(fake.out().slice(before)).toBe("no change\n");
    expect(call(setup(), "uninstall")).toBe(0);
    expect(setup().out()).toBe("");
  });

  it("prints changes as JSON", () => {
    const fake = setup();

    call(fake, "install");

    const before = fake.out().length;

    call(fake, "uninstall", "--json");

    expect(JSON.parse(fake.out().slice(before))).toEqual({
      changes: [
        `removed ${SKILL}`,
        `removed ${SETUP}`,
        ...FOUR.map((rule) => `removed deny rule ${rule}`),
      ],
    });
  });
});

describe("agents on the real filesystem", () => {
  it("installs into and uninstalls from a temporary home", () => {
    const home = makeTempDir("agents-home-");
    const io = {
      ...nodeIo(),
      env: (name: string) => (name === "HOME" ? home : undefined),
      stdout: () => {},
    };

    expect(run(["agents", "install"], io)).toBe(0);

    const settings = JSON.parse(
      readFileSync(join(home, ".claude", "settings.json"), "utf8"),
    );

    expect(settings.permissions.deny).toEqual(FOUR);
    expect(
      readFileSync(
        join(home, ".claude", "skills", "recognizer", "SKILL.md"),
        "utf8",
      ),
    ).toContain("recognizer help agents");
    expect(run(["agents", "uninstall"], io)).toBe(0);
    expect(nodeIo().exists(join(home, ".claude", "skills", "recognizer"))).toBe(
      false,
    );
  });
});
