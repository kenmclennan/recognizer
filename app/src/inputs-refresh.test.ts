import { describe, expect, it } from "vitest";
import { inputsRefresh, singleFlight } from "./inputs-refresh";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });

  return { promise, resolve, reject };
}

const settle = () => new Promise<void>((done) => setImmediate(done));

function harness() {
  const log: string[] = [];
  const refreshes: ReturnType<typeof deferred>[] = [];
  const doctors: ReturnType<typeof deferred>[] = [];
  const handler = inputsRefresh({
    refresh: () => {
      log.push("refresh");
      const one = deferred();
      refreshes.push(one);

      return one.promise;
    },
    doctor: () => {
      log.push("doctor");
      const one = deferred();
      doctors.push(one);

      return one.promise;
    },
  });

  return { log, refreshes, doctors, handler };
}

describe("inputsRefresh", () => {
  it("runs one refresh then one doctor for one event, the doctor after the refresh resolved", async () => {
    const { log, refreshes, doctors, handler } = harness();

    const done = handler();
    await settle();

    expect(log).toEqual(["refresh"]);

    refreshes[0]?.resolve();
    await done;
    await settle();

    expect(log).toEqual(["refresh", "doctor"]);
    expect(doctors).toHaveLength(1);
  });

  it("collapses events during a doctor run into one trailing run started after it ends", async () => {
    const { log, refreshes, doctors, handler } = harness();

    const first = handler();
    refreshes[0]?.resolve();
    await first;
    await settle();

    const second = handler();
    const third = handler();
    await settle();
    refreshes[1]?.resolve();
    refreshes[2]?.resolve();
    await second;
    await third;
    await settle();

    expect(log.filter((entry) => entry === "doctor")).toHaveLength(1);

    doctors[0]?.resolve();
    await settle();

    expect(log.filter((entry) => entry === "doctor")).toHaveLength(2);

    doctors[1]?.resolve();
    await settle();

    expect(doctors).toHaveLength(2);
  });

  it("starts the trailing run when the doctor in flight rejects", async () => {
    const { doctors, handler, refreshes } = harness();

    const first = handler();
    refreshes[0]?.resolve();
    await first;
    await settle();

    const second = handler();
    refreshes[1]?.resolve();
    await second;
    await settle();

    doctors[0]?.reject(new Error("survey failed"));
    await settle();

    expect(doctors).toHaveLength(2);
  });

  it("runs the doctor again for an event after everything settled", async () => {
    const { doctors, handler, refreshes } = harness();

    const first = handler();
    refreshes[0]?.resolve();
    await first;
    await settle();
    doctors[0]?.resolve();
    await settle();

    const again = handler();
    refreshes[1]?.resolve();
    await again;
    await settle();

    expect(doctors).toHaveLength(2);
  });
});

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
