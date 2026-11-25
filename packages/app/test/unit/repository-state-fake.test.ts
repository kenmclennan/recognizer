import { describe, expect, it } from "vitest";
import { fakeRepositoryState } from "../../src/repository-state-fake";

describe("repository state fake", () => {
  it("publishes scripted revisions to a watcher and serves scripted texts", async () => {
    const fake = fakeRepositoryState();
    const seen: number[] = [];
    const stop = await fake.watch((item) => seen.push(item.state.revision));
    const state = {
      repository: "/repo",
      revision: 2,
      registry: { catalog: { state: "read" as const }, entries: [] },
      run: null,
      results: {},
      freshness: {},
      unreadableReports: 0,
      inputsDigest: "d",
    };

    fake.publish(state);
    fake.setResults("crap", { overlay: {} as never });

    expect(seen).toEqual([2]);
    expect((await fake.readResults()).plugins.crap?.overlay).toEqual({});

    await fake.clearResults("crap");
    stop();
    fake.publish({ ...state, revision: 3 });

    expect(fake.cleared).toEqual(["crap"]);
    expect(seen).toEqual([2]);
    expect(fake.watching).toBe(0);
  });
});
