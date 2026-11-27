import type { RepositoryState } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { createRepositoryStateHolder } from "../../src/repository-state-holder";
import { scriptedBridge } from "./repository-state-bridge";
import { snapshotOf } from "./repository-state-snapshot";

function holderOver() {
  const { source, emit, calls } = scriptedBridge();

  return {
    holder: createRepositoryStateHolder(source),
    calls,
    publish: (state: RepositoryState) =>
      emit({ stream: "r1", window: "w-1", state }),
  };
}

describe("repository state holder", () => {
  it("waits for the first revision and then answers with the latest", async () => {
    const { holder, publish } = holderOver();

    await holder.start();

    const first = holder.latest();

    publish(snapshotOf(1, ["crap"]));

    expect((await first).revision).toBe(1);

    publish(snapshotOf(2, ["crap", "mutation"]));

    expect((await holder.latest()).revision).toBe(2);
  });

  it("ignores a revision older than the one it holds", async () => {
    const { holder, publish } = holderOver();

    await holder.start();
    publish(snapshotOf(5, ["crap"]));
    publish(snapshotOf(4, ["crap", "mutation"]));
    publish(snapshotOf(5, ["crap", "mutation"]));

    const held = await holder.latest();

    expect(held.revision).toBe(5);
    expect(held.registry.entries).toHaveLength(1);
  });

  it("calls an inputs listener when the inputs digest changes and not for the first revision or an unchanged one", async () => {
    const { holder, publish } = holderOver();
    let calls = 0;

    holder.onInputsChange(() => {
      calls += 1;
    });
    await holder.start();

    publish(snapshotOf(1, ["crap"], { inputsDigest: "a" }));
    publish(snapshotOf(2, ["crap"], { inputsDigest: "a" }));

    expect(calls).toBe(0);

    publish(snapshotOf(3, ["crap"], { inputsDigest: "b" }));

    expect(calls).toBe(1);
  });

  it("watches once however many callers start it", async () => {
    const { holder, publish, calls } = holderOver();
    const count = (op: string) => calls.filter((call) => call.op === op);

    await Promise.all([holder.start(), holder.start()]);
    publish(snapshotOf(1, ["crap"]));

    expect(count("repository.watch")).toHaveLength(1);
    expect(count("repository.unwatch")).toHaveLength(0);

    holder.stop();

    await Promise.resolve();

    expect(count("repository.unwatch")).toHaveLength(1);
    expect(count("repository.unwatch")[0]?.args).toEqual({ watch: "r1" });

    publish(snapshotOf(2, ["crap"]));

    expect(holder.current()).toBeNull();
  });
});
