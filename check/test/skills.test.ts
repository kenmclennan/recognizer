import { describe, expect, it } from "vitest";
import { SETUP_SKILL } from "../src/skills.js";

describe("the setup skill's policy step", () => {
  const step = SETUP_SKILL.split("\n").find((line) =>
    line.startsWith("3. Policy:"),
  ) as string;

  it("proposes ignore, entry and forbid written with recognizer policy", () => {
    expect(step).toContain("`ignore`");
    expect(step).toContain("`entry`");
    expect(step).toContain("`forbid`");
    expect(step).toContain("--add-forbid");
    expect(step).toContain("recognizer policy");
  });

  it("names no retired key", () => {
    expect(step).not.toMatch(/levels|uses|components/);
  });

  it("keeps the intent and skip sentences", () => {
    expect(step).toContain("never present a dependency direction");
    expect(step).toContain("The user can skip this step");
  });
});

describe("the setup skill's steps 2 and 3 use the setup verbs", () => {
  const lines = SETUP_SKILL.split("\n");
  const sensors = lines.find((line) => line.startsWith("2. ")) as string;
  const policy = lines.find((line) => line.startsWith("3. ")) as string;

  it("calls the survey in step 2 and recommend in step 3", () => {
    expect(sensors).toContain("recognizer setup survey");
    expect(policy).toContain("recognizer setup recommend");
  });

  it("names the policy verbs and none of the retired or hand-derived ones", () => {
    for (const word of ["--add-forbid", "ignore", "entry"]) {
      expect(policy).toContain(word);
    }

    for (const step of [sensors, policy]) {
      expect(step).not.toMatch(/levels|\buses\b/);
    }
  });
});
