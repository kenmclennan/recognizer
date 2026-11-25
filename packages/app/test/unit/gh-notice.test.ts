import { describe, expect, it } from "vitest";
import { ghNotice } from "../../src/gh-notice";

describe("ghNotice", () => {
  it("returns the text for missing, signed-out and failed and nothing for ok", () => {
    expect(ghNotice("missing", "")).toBe(
      "Pull requests need the GitHub CLI (gh). Install it from cli.github.com, then reopen this tab.",
    );
    expect(ghNotice("signed-out", "")).toBe(
      "Sign in to the GitHub CLI with gh auth login, then reopen this tab.",
    );
    expect(ghNotice("failed", "rate limited")).toBe("rate limited");
    expect(ghNotice("ok", "")).toBeNull();
  });
});
