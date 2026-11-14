import { SETUP_SKILL } from "recognizer";
import { describe, expect, it } from "vitest";
import { CLEAN_DOCTOR } from "./setup-fake";
import {
  ALL_SECTIONS_STATEMENT,
  buildPrompt,
  GRAMMAR_STATEMENT,
  READS_ARE_NOT_CHANGES_STATEMENT,
  SKILL_SECTIONS_STATEMENT,
  TICK_BOXES_STATEMENT,
  UNATTENDED_STATEMENT,
} from "./setup-prompt";

describe("the setup prompt", () => {
  const prompt = buildPrompt({
    status: "ok",
    report: {
      ...(CLEAN_DOCTOR as { report: object }).report,
      problems: 7,
    } as never,
  });

  it("holds the exact skill text imported from the library", () => {
    expect(prompt).toContain(SETUP_SKILL);
  });

  it("holds the doctor result", () => {
    expect(prompt).toContain('"problems": 7');
    expect(
      buildPrompt({ status: "unavailable", reason: "no toolchain" }),
    ).toContain("no toolchain");
  });

  it("holds each of the wrapper's statements", () => {
    for (const statement of [
      UNATTENDED_STATEMENT,
      SKILL_SECTIONS_STATEMENT,
      TICK_BOXES_STATEMENT,
      READS_ARE_NOT_CHANGES_STATEMENT,
      ALL_SECTIONS_STATEMENT,
      GRAMMAR_STATEMENT,
    ]) {
      expect(prompt).toContain(statement);
    }
  });

  it("states the four things 3.2 asks for by their own phrases", () => {
    expect(UNATTENDED_STATEMENT).toContain("unattended and read-only");
    expect(SKILL_SECTIONS_STATEMENT).toContain("Setup and Update sections");
    expect(TICK_BOXES_STATEMENT).toContain("replaced by tick-boxes");
    expect(READS_ARE_NOT_CHANGES_STATEMENT).toContain("only reads");
  });

  it("asks for all three sections every run, even when doctor is clean", () => {
    const clean = buildPrompt(CLEAN_DOCTOR);

    expect(clean).toContain(ALL_SECTIONS_STATEMENT);

    for (const phrase of [
      "all three sections every run",
      "no problems",
      "Problems",
      "Test suites",
      "Policy",
    ]) {
      expect(ALL_SECTIONS_STATEMENT).toContain(phrase);
    }
  });
});
