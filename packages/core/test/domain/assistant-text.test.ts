import { describe, expect, it } from "vitest";
import {
  type AssistantText,
  assistantTextOf,
  DEFAULT_ASSISTANT_TEXT,
} from "../../src/index.js";

function textOf(name: string): AssistantText {
  return {
    name,
    program: name.toLowerCase(),
    account_note: `Uses your ${name} account.`,
    signed_out_reason: `${name} is signed out.`,
    signed_out_markers: ["signed out"],
    limit_markers: ["limit"],
  };
}

describe("assistantTextOf", () => {
  it("an empty list publishes nothing", () => {
    expect(assistantTextOf([])).toBeNull();
  });

  it("returns the block of the first publisher in name order whatever the input order", () => {
    const describers = [
      { name: "zeta", assistant: textOf("Zeta") },
      { name: "mid" },
      { name: "alpha", assistant: textOf("Alpha") },
    ];

    expect(assistantTextOf(describers)).toEqual(textOf("Alpha"));
    expect(assistantTextOf([...describers].reverse())).toEqual(textOf("Alpha"));
  });

  it("a describer with no block contributes nothing and the answer is never the default", () => {
    const answer = assistantTextOf([
      { name: "a" },
      { name: "b", assistant: textOf("Bee") },
    ]);

    expect(answer).toEqual(textOf("Bee"));
    expect(answer).not.toEqual(DEFAULT_ASSISTANT_TEXT);
    expect(assistantTextOf([{ name: "a" }])).toBeNull();
  });
});
