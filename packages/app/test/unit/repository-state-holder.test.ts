import { describe, expect, it } from "vitest";
import { fakeRepositoryState } from "../../src/repository-state-fake";
import { createRepositoryStateHolder } from "../../src/repository-state-holder";
import { snapshotOf } from "./repository-state-snapshot";

describe("repository state holder", () => {
  it("waits for the first revision and then answers with the latest", async () => {
    const fake = fakeRepositoryState();
    const holder = createRepositoryStateHolder(fake);
    const first = holder.latest();

    fake.publish(snapshotOf(1, ["crap"]));

    expect((await first).revision).toBe(1);

    fake.publish(snapshotOf(2, ["crap", "mutation"]));

    expect((await holder.latest()).revision).toBe(2);
  });

  it("ignores a revision older than the one it holds", async () => {
    const fake = fakeRepositoryState();
    const holder = createRepositoryStateHolder(fake);

    await holder.start();
    fake.publish(snapshotOf(5, ["crap"]));
    fake.publish(snapshotOf(4, ["crap", "mutation"]));

    const held = await holder.latest();

    expect(held.revision).toBe(5);
    expect(held.registry.entries).toHaveLength(1);
  });

  it("calls an inputs listener when the inputs digest changes and not for the first revision or an unchanged one", async () => {
    const fake = fakeRepositoryState();
    const holder = createRepositoryStateHolder(fake);
    let calls = 0;

    holder.onInputsChange(() => {
      calls += 1;
    });
    await holder.start();

    fake.publish(snapshotOf(1, ["crap"], { inputsDigest: "a" }));
    fake.publish(snapshotOf(2, ["crap"], { inputsDigest: "a" }));

    expect(calls).toBe(0);

    fake.publish(snapshotOf(3, ["crap"], { inputsDigest: "b" }));

    expect(calls).toBe(1);
  });

  it("watches once however many callers start it", async () => {
    const fake = fakeRepositoryState();
    const holder = createRepositoryStateHolder(fake);

    await Promise.all([holder.start(), holder.start()]);
    fake.publish(snapshotOf(1, ["crap"]));

    expect(fake.watching).toBe(1);

    holder.stop();

    expect(fake.watching).toBe(0);
  });
});
