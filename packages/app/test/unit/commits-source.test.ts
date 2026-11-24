import { describe, expect, it } from "vitest";
import { createCommitsSource } from "../../src/commits-source";

function fixture() {
  const calls: { command: string; args: Record<string, unknown> }[] = [];
  const handlers = new Map<string, () => void>();
  const stopped: string[] = [];
  const call = (async (command: string, args: Record<string, unknown> = {}) => {
    calls.push({ command, args });

    return { ok: { op: args.op ?? command } };
  }) as never;
  const on = async (event: string, handler: () => void) => {
    handlers.set(event, handler);

    return () => stopped.push(event);
  };

  return { calls, handlers, stopped, source: createCommitsSource(call, on) };
}

describe("the commits source", () => {
  it("sends each of the five queries through core_call with its op and arguments", async () => {
    const { calls, source } = fixture();

    await source.listHistory();
    await source.listBranches();
    await source.refFacts(["a", "b"]);
    await source.listPullRequests();
    await source.changeDetail("pr", "12");

    expect(calls.map((entry) => entry.command)).toEqual(
      Array(5).fill("core_call"),
    );
    expect(calls.map((entry) => entry.args)).toEqual([
      { op: "history.list", args: {} },
      { op: "history.branches", args: {} },
      { op: "history.facts", args: { refs: ["a", "b"] } },
      { op: "history.pulls", args: {} },
      { op: "history.detail", args: { kind: "pr", reference: "12" } },
    ]);
  });

  it("throws the service's error text", async () => {
    const source = createCommitsSource((async () => ({
      error: "not a git repository",
    })) as never);

    await expect(source.listHistory()).rejects.toThrow("not a git repository");
  });

  it("watches git-changed, invokes watch_git, then unwatch_git on stop", async () => {
    const { calls, handlers, stopped, source } = fixture();
    let changes = 0;
    const stop = source.watchGit(() => {
      changes += 1;
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(handlers.has("git-changed")).toBe(true);
    expect(calls.map((entry) => entry.command)).toContain("watch_git");

    handlers.get("git-changed")?.();

    expect(changes).toBe(1);

    stop();
    await Promise.resolve();
    await Promise.resolve();

    expect(calls.map((entry) => entry.command)).toContain("unwatch_git");
    expect(stopped).toEqual(["git-changed"]);
  });
});
