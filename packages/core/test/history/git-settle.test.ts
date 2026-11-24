import { describe, expect, it } from "vitest";
import {
  beginGitWatch,
  endGitWatch,
  GitSettle,
  Limiter,
  pollGitWatch,
  WindowBaselines,
} from "../../src/index.js";
import { FakeGit } from "../fakes/fake-git.js";

function settle(last: string, polls: string[]): number | null {
  const state = new GitSettle(last);
  const at = polls.findIndex((next) => state.poll(next));

  return at === -1 ? null : at;
}

describe("GitSettle", () => {
  it("snapshot changed is false for equal snapshots and true otherwise", async () => {
    const git = new FakeGit(null);
    const windows = new WindowBaselines();
    const ports = { git, limiter: new Limiter(4) };

    await beginGitWatch(ports, windows, "w-1", "/r");

    expect(await pollGitWatch(ports, windows, "w-1", "/r")).toEqual({
      changed: false,
    });

    git.state = "state-1";

    expect(await pollGitWatch(ports, windows, "w-1", "/r")).toEqual({
      changed: false,
    });
    expect(await pollGitWatch(ports, windows, "w-1", "/r")).toEqual({
      changed: true,
    });

    endGitWatch(windows, "w-1");

    expect(await pollGitWatch(ports, windows, "w-1", "/r")).toEqual({
      changed: false,
    });
  });

  it("settle emits nothing while the snapshot is unchanged", () => {
    expect(settle("a", ["a", "a", "a"])).toBeNull();
  });

  it("settle emits at the poll that sees the change unchanged", () => {
    expect(settle("a", ["b", "b"])).toBe(1);
  });

  it("settle emits on the bound when every poll changes", () => {
    expect(settle("a", "bcdefghijklmnop".split(""))).toBe(8);
  });

  it("settle does not emit one poll before the bound", () => {
    expect(settle("a", "bcdefghi".split(""))).toBeNull();
  });

  it("settle emits again for a second change", () => {
    const state = new GitSettle("a");

    expect(["b", "b", "b", "c", "c"].map((next) => state.poll(next))).toEqual([
      false,
      true,
      false,
      false,
      true,
    ]);
  });
});
