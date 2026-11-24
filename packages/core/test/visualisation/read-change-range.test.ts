import { describe, expect, it } from "vitest";
import { readChangeRange } from "../../src/index.js";
import { FakeGit } from "../fakes/fake-git.js";

const BASE = "aaaaaaa1";
const HEAD = "bbbbbbb2";

function git(): FakeGit {
  const fake = new FakeGit("c0ffee");

  fake.refs.set("main", BASE);
  fake.refs.set("topic", HEAD);

  return fake;
}

describe("readChangeRange", () => {
  it("reads a rename as old then new path", () => {
    const fake = git();

    fake.diffs.set(`${BASE}...${HEAD}`, [
      { status: "R", path: "new.ts", from: "old.ts" },
      { status: "A", path: "added.ts" },
    ]);

    expect(readChangeRange({ git: fake }, "/r", "main", "topic")).toEqual({
      baseCommit: BASE,
      headCommit: HEAD,
      merged: false,
      changes: [
        { status: "R", path: "new.ts", from: "old.ts" },
        { status: "A", path: "added.ts" },
      ],
    });
  });

  it("a diverged branch is not merged and has its changes", () => {
    const fake = git();

    fake.diffs.set(`${BASE}...${HEAD}`, [{ status: "M", path: "a.ts" }]);

    const range = readChangeRange({ git: fake }, "/r", "main", "topic");

    expect(range?.merged).toBe(false);
    expect(range?.changes).toHaveLength(1);
  });

  it("a head behind the base is merged", () => {
    const fake = git();

    fake.ancestors.add(`${HEAD}>${BASE}`);
    fake.diffs.set(`${BASE}...${HEAD}`, []);

    expect(readChangeRange({ git: fake }, "/r", "main", "topic")?.merged).toBe(
      true,
    );
  });

  it("equal commits are not merged and have no changes", () => {
    const fake = git();

    fake.refs.set("same", BASE);
    fake.diffs.set(`${BASE}...${BASE}`, []);

    expect(readChangeRange({ git: fake }, "/r", "main", "same")).toEqual({
      baseCommit: BASE,
      headCommit: BASE,
      merged: false,
      changes: [],
    });
  });

  it("an unknown head or base gives its commit as null and no changes", () => {
    expect(readChangeRange({ git: git() }, "/r", "main", "ghost")).toEqual({
      baseCommit: BASE,
      headCommit: null,
      merged: false,
      changes: [],
    });
    expect(readChangeRange({ git: git() }, "/r", "ghost", "topic")).toEqual({
      baseCommit: null,
      headCommit: HEAD,
      merged: false,
      changes: [],
    });
  });

  it("option-shaped refs are refused before git runs", () => {
    const fake = git();

    expect(readChangeRange({ git: fake }, "/r", "--output=x", "topic")).toBe(
      null,
    );
    expect(readChangeRange({ git: fake }, "/r", "main", "a..b")).toBe(null);
    expect(fake.calls).toEqual([]);
  });

  it("a folder outside git returns null", () => {
    expect(
      readChangeRange({ git: new FakeGit(null) }, "/r", "main", "topic"),
    ).toBe(null);
  });

  it("returns null when git could not diff", () => {
    expect(readChangeRange({ git: git() }, "/r", "main", "topic")).toBe(null);
  });
});
