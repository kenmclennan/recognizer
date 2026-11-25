import { describe, expect, it } from "vitest";
import { singleFlight } from "../../src/single-flight";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

const settle = () => new Promise<void>((done) => setImmediate(done));

describe("singleFlight", () => {
  it("never has two runs in flight for direct calls", async () => {
    const runs: ReturnType<typeof deferred>[] = [];
    const call = singleFlight(() => {
      const one = deferred();
      runs.push(one);

      return one.promise;
    });

    call();
    call();
    await settle();

    expect(runs).toHaveLength(1);

    runs[0]?.resolve();
    await settle();

    expect(runs).toHaveLength(2);
  });
});
