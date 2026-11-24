import { describe, expect, it } from "vitest";
import { scansAtCommit } from "../../src/index.js";
import { HistoryWorld } from "./history-world.js";

function world(): HistoryWorld {
  const world = new HistoryWorld();

  world.git.archives.set("abcdef1", []);

  return world;
}

describe("scansAtCommit", () => {
  it("returns the scan files of the commit", async () => {
    const w = world();

    expect(await scansAtCommit(w.ports, "/r", "abcdef1")).toEqual({
      ok: true,
      scans: [{ file: "scan.typescript.json", text: "{}" }],
    });
  });

  it("refuses a commit that is not 7 to 64 lowercase hex characters", async () => {
    const w = world();

    expect(await scansAtCommit(w.ports, "/r", "--output=x")).toEqual({
      ok: false,
      reason: "not a commit in this repository: --output=x",
    });
    expect(w.scan.requests).toEqual([]);
  });

  it("never runs more than the bound at once", async () => {
    const w = world();

    w.scan.delay = 5;

    const commits = Array.from({ length: 24 }, (_, index) =>
      `abcdef${(index + 16).toString(16)}`.padEnd(8, "0"),
    );

    for (const commit of commits) {
      w.git.archives.set(commit, []);
    }

    const results = await Promise.all(
      commits.map((commit) => scansAtCommit(w.ports, "/r", commit)),
    );

    expect(results.every((result) => result.ok)).toBe(true);
    expect(w.scan.peak).toBeLessThanOrEqual(3);
    expect(w.scan.requests).toHaveLength(24);
    expect(w.scratch.removed).toHaveLength(24);
    expect(w.scratch.folders.size).toBe(0);
  });

  it("runs identical comparisons once and a repeat inside the window none", async () => {
    const w = world();

    w.scan.delay = 5;

    await Promise.all([
      scansAtCommit(w.ports, "/r", "abcdef1"),
      scansAtCommit(w.ports, "/r", "abcdef1"),
    ]);
    expect(w.scan.requests).toHaveLength(1);

    w.clock.advance(599_000);
    await scansAtCommit(w.ports, "/r", "abcdef1");
    expect(w.scan.requests).toHaveLength(1);

    w.clock.advance(1_000);
    await scansAtCommit(w.ports, "/r", "abcdef1");
    expect(w.scan.requests).toHaveLength(2);
  });

  it("keeps a failed comparison's reason on a cache hit, and forgets it after 60 s", async () => {
    const w = world();

    w.scan.outcome = { status: "failed", reason: "phases" };
    w.scan.stderr = ["", "  boom happened  ", "second"];
    w.cache.fallback = [];

    const first = await scansAtCommit(w.ports, "/r", "abcdef1");

    expect(first).toEqual({ ok: false, reason: "boom happened" });
    w.clock.advance(59_000);
    expect(await scansAtCommit(w.ports, "/r", "abcdef1")).toEqual(first);
    expect(w.scan.requests).toHaveLength(1);

    w.clock.advance(1_000);
    await scansAtCommit(w.ports, "/r", "abcdef1");
    expect(w.scan.requests).toHaveLength(2);
  });

  it("removes the scratch folder when the scan fails", async () => {
    const w = world();

    w.scan.outcome = { status: "failed", reason: "phases" };
    w.cache.fallback = [];
    await scansAtCommit(w.ports, "/r", "abcdef1");

    expect(w.scratch.removed).toHaveLength(1);
    expect(w.scratch.folders.size).toBe(0);
  });

  it("removes the scratch folder when the scan throws", async () => {
    const w = world();

    w.scan.throws = true;

    await expect(scansAtCommit(w.ports, "/r", "abcdef1")).rejects.toThrow(
      "could not start",
    );
    expect(w.scratch.removed).toHaveLength(1);
    expect(w.scratch.folders.size).toBe(0);
  });

  it("reason is the scan's first message line", async () => {
    const w = world();

    w.scan.outcome = { status: "failed", reason: "phases" };
    w.scan.stderr = ["first line\nsecond line"];
    w.cache.fallback = [];

    expect(await scansAtCommit(w.ports, "/r", "abcdef1")).toEqual({
      ok: false,
      reason: "first line",
    });
  });

  it("reason names a scan that found no modules", async () => {
    const w = world();

    w.cache.fallback = [];

    expect(await scansAtCommit(w.ports, "/r", "abcdef1")).toEqual({
      ok: false,
      reason: "the scan found no modules at abcdef1",
    });
  });

  it("reason names a commit git could not extract", async () => {
    const w = world();

    expect(await scansAtCommit(w.ports, "/r", "1234567")).toEqual({
      ok: false,
      reason: "git could not extract 1234567",
    });
    expect(w.scratch.folders.size).toBe(0);
  });

  it("both historical scans pass ignoreRetiredConfig", async () => {
    const w = world();

    await scansAtCommit(w.ports, "/r", "abcdef1");

    expect(w.scan.requests[0]).toMatchObject({
      ignoreRetiredConfig: true,
      mode: "incremental",
      sensors: null,
      describe: false,
      analysis: true,
    });
  });
});
