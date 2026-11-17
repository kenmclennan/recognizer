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
