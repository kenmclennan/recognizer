import { describe, expect, it } from "vitest";
import { createRepositoryStateSource } from "../../src/repository-state-source";

type Handler = (event: { payload: unknown }) => void;

function harness() {
  const calls: { op: string; args: Record<string, unknown> }[] = [];
  let handler: Handler = () => {};
  const source = createRepositoryStateSource({
    invoke: (async (_command: string, args?: Record<string, unknown>) => {
      const call = args as { op: string; args: Record<string, unknown> };

      calls.push(call);

      return { ok: call.op === "repository.watch" ? "r1" : null };
    }) as never,
    listen: (async (_event: string, next: Handler) => {
      handler = next;

      return () => {
        handler = () => {};
      };
    }) as never,
    windowLabel: () => "w-1",
  });

  return { calls, source, emit: (payload: unknown) => handler({ payload }) };
}

describe("repository state source", () => {
  it("delivers each state revision for this window and ignores other items", async () => {
    const { source, emit } = harness();
    const seen: number[] = [];

    await source.watch((item) => seen.push(item.state.revision));

    emit({ stream: "r1", window: "w-1", state: { revision: 1 } });
    emit({ stream: "r1", window: "w-2", state: { revision: 2 } });
    emit({ stream: "s1", window: "w-1", line: "progress" });
    emit({ stream: "r2", window: "w-1", state: { revision: 3 } });

    expect(seen).toEqual([1, 3]);
  });

  it("stopping the watch ends the stream through core", async () => {
    const { source, calls } = harness();
    const stop = await source.watch(() => {});

    stop();

    await Promise.resolve();

    expect(calls.map((call) => call.op)).toEqual([
      "repository.watch",
      "repository.unwatch",
    ]);
    expect(calls[1]?.args).toEqual({ watch: "r1" });
  });

  it("reads results and clears one plugin through core", async () => {
    const { source, calls } = harness();

    await source.readResults();
    await source.clearResults("crap");

    expect(calls).toEqual([
      { op: "results.read", args: {} },
      { op: "results.clear", args: { plugin: "crap" } },
    ]);
  });
});
