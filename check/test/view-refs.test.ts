import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isValidRef, parseRange } from "../src/views.js";
import { REPO } from "./helpers.js";

const refs = JSON.parse(
  readFileSync(join(REPO, "fixtures/views/refs.json"), "utf8"),
) as { accept: string[]; reject: string[] };

describe("view refs", () => {
  it.each(refs.accept)("accepts %j", (ref) => {
    expect(isValidRef(ref)).toBe(true);
  });

  it.each(refs.reject)("rejects %j", (ref) => {
    expect(isValidRef(ref)).toBe(false);
  });

  it("splits a range at the first dots", () => {
    expect(parseRange("main..feat")).toEqual({ base: "main", head: "feat" });
    expect(parseRange("main")).toBeNull();
    expect(parseRange("--x..feat")).toBeNull();
  });
});
