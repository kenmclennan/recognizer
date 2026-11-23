import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ViewRange } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { REPO } from "./helpers.js";

const refs = JSON.parse(
  readFileSync(join(REPO, "fixtures/views/refs.json"), "utf8"),
) as { accept: string[]; reject: string[] };

describe("view refs", () => {
  it.each(refs.accept)("accepts %j", (ref) => {
    expect(ViewRange.isValidRef(ref)).toBe(true);
  });

  it.each(refs.reject)("rejects %j", (ref) => {
    expect(ViewRange.isValidRef(ref)).toBe(false);
  });

  it("splits a range at the first dots", () => {
    expect(ViewRange.parse("main..feat")).toEqual({
      base: "main",
      head: "feat",
    });
    expect(ViewRange.parse("main")).toBeNull();
    expect(ViewRange.parse("--x..feat")).toBeNull();
  });
});
