import { describe, expect, it } from "vitest";
import { listRenamesSince } from "../../src/index.js";
import { FakeGit } from "../fakes/fake-git.js";

describe("listRenamesSince", () => {
  it("lists each rename as from and to", () => {
    const git = new FakeGit("c0ffee");

    git.renames.set("abcdef1", new Map([["old.ts", "new.ts"]]));

    expect(listRenamesSince({ git }, "/r", "abcdef1")).toEqual([
      { from: "old.ts", to: "new.ts" },
    ]);
  });

  it("refuses option-shaped and malformed commits", () => {
    const git = new FakeGit("c0ffee");

    git.renames.set("--output=x", new Map([["a", "b"]]));
    git.renames.set("abc", new Map([["a", "b"]]));
    git.renames.set("ABCDEF1", new Map([["a", "b"]]));

    for (const commit of ["--output=x", "abc", "ABCDEF1", ""]) {
      expect(listRenamesSince({ git }, "/r", commit)).toEqual([]);
    }

    expect(git.calls).toEqual([]);
  });
});
