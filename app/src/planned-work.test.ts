import { describe, expect, it } from "vitest";
import { createPlannedWork, fingerprint, workKey } from "./planned-work";
import { fakeSensors } from "./sensors-fake";

const SCOPE = {
  sensor: "mutation",
  modules: ["b.py", "a.py"],
  suites: ["unit"],
  stamp: "s1",
};

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("the planned work cache", () => {
  it("asks the port once for a scope however often it is ensured", async () => {
    const fake = fakeSensors();

    fake.work.set("mutation", { unit: "functions", to_perform: 4 });

    const cache = createPlannedWork(fake, () => {});

    cache.ensure(SCOPE);
    cache.ensure({ ...SCOPE, modules: ["a.py", "b.py"] });
    await tick();

    expect(fake.workRequests).toEqual([
      { sensor: "mutation", modules: ["b.py", "a.py"], suites: ["unit"] },
    ]);
  });

  it("holds no answer while the port is pending, then the answer and a change call", async () => {
    const fake = fakeSensors();
    let changed = 0;

    fake.work.set("mutation", { unit: "functions", to_perform: 4 });
    fake.holdWork = true;

    const cache = createPlannedWork(fake, () => {
      changed += 1;
    });

    cache.ensure(SCOPE);
    await tick();

    expect(cache.answers([SCOPE])).toEqual({});
    expect(changed).toBe(0);

    fake.releaseWork();
    await tick();

    expect(cache.answers([SCOPE])).toEqual({
      mutation: { unit: "functions", to_perform: 4 },
    });
    expect(changed).toBe(1);
  });

  it("asks again when the stamp changes and gives no answer for a sensor that has none", async () => {
    const fake = fakeSensors();
    const cache = createPlannedWork(fake, () => {});

    cache.ensure(SCOPE);
    cache.ensure({ ...SCOPE, stamp: "s2" });
    await tick();

    expect(fake.workRequests).toHaveLength(2);
    expect(cache.answers([SCOPE])).toEqual({});
  });

  it("treats a port failure as no answer", async () => {
    const fake = fakeSensors();
    const cache = createPlannedWork(
      {
        plannedWork: async () => {
          throw new Error("down");
        },
      },
      () => {},
    );

    cache.ensure(SCOPE);
    await tick();

    expect(cache.answers([SCOPE])).toEqual({});
    expect(fake.workRequests).toEqual([]);
  });
});

describe("workKey and fingerprint", () => {
  it("ignores the order of modules and suites", () => {
    expect(workKey({ ...SCOPE, modules: ["a.py", "b.py"] })).toBe(
      workKey(SCOPE),
    );
  });

  it("tells a whole-repository scope from a scoped one", () => {
    expect(workKey({ ...SCOPE, modules: null })).not.toBe(workKey(SCOPE));
  });

  it("gives equal text equal fingerprints and different text different ones", () => {
    expect(fingerprint("abc")).toBe(fingerprint("abc"));
    expect(fingerprint("abc")).not.toBe(fingerprint("abd"));
  });
});
