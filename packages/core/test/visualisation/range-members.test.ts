import { describe, expect, it } from "vitest";
import { rangeMembers } from "../../src/index.js";
import { HistoryWorld } from "./history-world.js";

const BASE = "aaaaaaa1";
const HEAD = "bbbbbbb2";

function world(): HistoryWorld {
  const world = new HistoryWorld();

  world.git.refs.set("main", BASE);
  world.git.refs.set("topic", HEAD);
  world.git.archives.set(BASE, []);
  world.git.archives.set(HEAD, []);

  return world;
}

describe("rangeMembers", () => {
  it("returns both scans and both texts of a modified and a renamed file", async () => {
    const w = world();

    w.git.diffs.set(`${BASE}...${HEAD}`, [
      { status: "M", path: "a.ts" },
      { status: "R", path: "n.ts", from: "o.ts" },
      { status: "A", path: "added.ts" },
      { status: "D", path: "gone.ts" },
    ]);
    w.git.texts.set(`${BASE}:a.ts`, "old a");
    w.git.texts.set(`${HEAD}:a.ts`, "new a");
    w.git.texts.set(`${BASE}:o.ts`, "old o");
    w.git.texts.set(`${HEAD}:n.ts`, "new n");

    const result = await rangeMembers(w.ports, "/r", "main", "topic");

    expect(result).toMatchObject({
      ok: true,
      files: [
        {
          path: "a.ts",
          basePath: "a.ts",
          baseText: "old a",
          headText: "new a",
        },
        {
          path: "n.ts",
          basePath: "o.ts",
          baseText: "old o",
          headText: "new n",
        },
      ],
    });
    expect(w.git.archived).toEqual([
      { commit: BASE, paths: ["a.ts", "o.ts"] },
      { commit: HEAD, paths: ["a.ts", "n.ts"] },
    ]);
  });

  it("gives null for a text absent at one commit and keeps the other", async () => {
    const w = world();

    w.git.diffs.set(`${BASE}...${HEAD}`, [
      { status: "M", path: "a.ts" },
      { status: "M", path: "b.ts" },
    ]);
    w.git.texts.set(`${BASE}:a.ts`, "old a");
    w.git.texts.set(`${HEAD}:a.ts`, "new a");
    w.git.texts.set(`${HEAD}:b.ts`, "new b");

    const result = await rangeMembers(w.ports, "/r", "main", "topic");

    expect(result).toMatchObject({
      ok: true,
      files: [
        { baseText: "old a", headText: "new a" },
        { baseText: null, headText: "new b" },
      ],
    });
  });

  it("refuses option-shaped refs", async () => {
    const w = world();

    expect(await rangeMembers(w.ports, "/r", "--x", "topic")).toEqual({
      ok: false,
      reason: "not a commit in this repository: --x",
    });
    expect(await rangeMembers(w.ports, "/r", "main", "ghost")).toEqual({
      ok: false,
      reason: "not a commit in this repository: ghost",
    });
    expect(w.scan.requests).toEqual([]);
  });

  it("refuses a range of 201 modified files and accepts one of 200", async () => {
    const w = world();
    const modified = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        status: "M" as const,
        path: `f${index}.ts`,
      }));

    w.git.diffs.set(`${BASE}...${HEAD}`, modified(201));
    expect(await rangeMembers(w.ports, "/r", "main", "topic")).toEqual({
      ok: false,
      reason: "201 modified files, over the limit of 200",
    });

    w.git.diffs.set(`${BASE}...${HEAD}`, modified(200));
    w.clock.advance(61_000);
    expect(await rangeMembers(w.ports, "/r", "main", "topic")).toMatchObject({
      ok: true,
    });
  });

  it("gives its reason for a range with no modified files", async () => {
    const w = world();

    w.git.diffs.set(`${BASE}...${HEAD}`, [{ status: "A", path: "x.ts" }]);

    expect(await rangeMembers(w.ports, "/r", "main", "topic")).toEqual({
      ok: false,
      reason: "no modified files in this range",
    });
  });

  it("gives its reason when git could not diff", async () => {
    const w = world();

    expect(await rangeMembers(w.ports, "/r", "main", "topic")).toEqual({
      ok: false,
      reason: `git could not diff ${BASE}...${HEAD}`,
    });
  });

  it("a failed base scan is the reason and no head scan starts, and the reverse", async () => {
    const w = world();

    w.git.diffs.set(`${BASE}...${HEAD}`, [{ status: "M", path: "a.ts" }]);
    w.git.archives.delete(BASE);

    expect(await rangeMembers(w.ports, "/r", "main", "topic")).toEqual({
      ok: false,
      reason: `git could not extract ${BASE.slice(0, 7)}`,
    });
    expect(w.git.archived).toEqual([]);

    const reverse = world();

    reverse.git.diffs.set(`${BASE}...${HEAD}`, [{ status: "M", path: "a.ts" }]);
    reverse.git.archives.delete(HEAD);

    expect(await rangeMembers(reverse.ports, "/r", "main", "topic")).toEqual({
      ok: false,
      reason: `git could not extract ${HEAD.slice(0, 7)}`,
    });
    expect(reverse.scan.requests).toHaveLength(1);
  });

  it("both historical scans pass ignoreRetiredConfig", async () => {
    const w = world();

    w.git.diffs.set(`${BASE}...${HEAD}`, [{ status: "M", path: "a.ts" }]);
    await rangeMembers(w.ports, "/r", "main", "topic");

    expect(w.scan.requests.map((r) => r.ignoreRetiredConfig)).toEqual([
      true,
      true,
    ]);
  });
});
