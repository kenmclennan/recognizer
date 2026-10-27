import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildUpdater,
  CHECK_EVERY_MS,
  DISABLED_REASON,
  FIRST_CHECK_MS,
  type FoundUpdate,
  type UpdateState,
} from "./updater";

function setup(enabled = true) {
  const scheduled: { run: () => void; ms: number }[] = [];
  const repeated: { run: () => void; ms: number }[] = [];
  const states: UpdateState[] = [];
  const notices: string[] = [];
  const calls = { checks: 0, relaunches: 0 };
  const ports = {
    enabled,
    next: null as FoundUpdate | null | Error,
    relaunchFails: false,
  };
  const updater = buildUpdater({
    enabled,
    async check() {
      calls.checks++;

      if (ports.next instanceof Error) {
        throw ports.next;
      }

      return ports.next;
    },
    async relaunch() {
      calls.relaunches++;
    },
    schedule: (run, ms) => {
      scheduled.push({ run, ms });

      return () => {};
    },
    scheduleEvery: (run, ms) => {
      repeated.push({ run, ms });

      return () => {};
    },
    onState: (state) => states.push(state),
    notify: (text) => notices.push(text),
  });

  return { updater, scheduled, repeated, states, notices, calls, ports };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("updater", () => {
  it("never schedules or checks when disabled", async () => {
    const t = setup(false);

    t.updater.start();

    expect(t.scheduled).toEqual([]);
    expect(t.repeated).toEqual([]);
    expect(t.calls.checks).toBe(0);
  });

  it("schedules one check at 30 seconds and a repeat every 6 hours", () => {
    const t = setup();

    t.updater.start();

    expect(t.scheduled.map((s) => s.ms)).toEqual([30 * 1000]);
    expect(t.repeated.map((s) => s.ms)).toEqual([6 * 60 * 60 * 1000]);
    expect(FIRST_CHECK_MS).toBe(30000);
    expect(CHECK_EVERY_MS).toBe(21600000);
  });

  it("changes nothing and notifies nothing when a check throws", async () => {
    const t = setup();

    t.ports.next = new Error("offline");
    t.updater.start();
    t.scheduled[0].run();
    await tick();

    expect(t.calls.checks).toBe(1);
    expect(t.states).toEqual([]);
    expect(t.notices).toEqual([]);
  });

  it("shows an available update and keeps it after a later empty check", async () => {
    const t = setup();

    t.ports.next = { version: "0.2.0", install: async () => {} };
    t.updater.start();
    t.scheduled[0].run();
    await tick();
    t.ports.next = null;
    t.repeated[0].run();
    await tick();

    expect(t.states).toEqual([{ kind: "available", version: "0.2.0" }]);
  });

  it("returns to available and notifies when the install fails", async () => {
    const t = setup();

    t.ports.next = {
      version: "0.2.0",
      install: async () => {
        throw new Error("disk full");
      },
    };
    t.updater.start();
    t.scheduled[0].run();
    await tick();
    await t.updater.install();

    expect(t.states).toEqual([
      { kind: "available", version: "0.2.0" },
      { kind: "installing", version: "0.2.0" },
      { kind: "available", version: "0.2.0" },
    ]);
    expect(t.notices).toEqual(["Update failed: disk full"]);
    expect(t.calls.relaunches).toBe(0);
  });

  it("sets installing and then relaunches on a successful install", async () => {
    const t = setup();

    t.ports.next = { version: "0.2.0", install: async () => {} };
    t.updater.start();
    t.scheduled[0].run();
    await tick();
    await t.updater.install();

    expect(t.states[t.states.length - 1]).toEqual({
      kind: "installing",
      version: "0.2.0",
    });
    expect(t.calls.relaunches).toBe(1);
  });

  it("does nothing on install when no update is available", async () => {
    const t = setup();

    await t.updater.install();

    expect(t.states).toEqual([]);
    expect(t.calls.relaunches).toBe(0);
  });

  it("reports a found update from a manual check and moves the shared state", async () => {
    const t = setup();

    t.ports.next = { version: "0.2.0", install: async () => {} };

    expect(await t.updater.checkNow()).toEqual({
      kind: "found",
      version: "0.2.0",
    });
    expect(t.states).toEqual([{ kind: "available", version: "0.2.0" }]);
    expect(t.updater.state()).toEqual({ kind: "available", version: "0.2.0" });
  });

  it("reports up to date from a manual check without changing state", async () => {
    const t = setup();

    t.ports.next = null;

    expect(await t.updater.checkNow()).toEqual({ kind: "up-to-date" });
    expect(t.states).toEqual([]);
  });

  it("reports the error text when a manual check fails", async () => {
    const t = setup();

    t.ports.next = new Error("offline");

    expect(await t.updater.checkNow()).toEqual({
      kind: "failed",
      reason: "offline",
    });
    expect(t.notices).toEqual([]);
  });

  it("fails a manual check with a reason when the updater is disabled", async () => {
    const t = setup(false);

    expect(await t.updater.checkNow()).toEqual({
      kind: "failed",
      reason: DISABLED_REASON,
    });
    expect(t.calls.checks).toBe(0);
  });

  it("runs no check while an install is running", async () => {
    const t = setup();
    let finish: () => void = () => {};

    t.ports.next = {
      version: "0.2.0",
      install: () => new Promise<void>((resolve) => (finish = resolve)),
    };
    await t.updater.checkNow();

    const running = t.updater.install();

    expect(await t.updater.checkNow()).toEqual({
      kind: "installing",
      version: "0.2.0",
    });
    expect(t.calls.checks).toBe(1);

    finish();
    await running;
  });

  it("returns the failure reason from a failed install", async () => {
    const t = setup();

    t.ports.next = {
      version: "0.2.0",
      install: async () => {
        throw new Error("disk full");
      },
    };
    await t.updater.checkNow();

    expect(await t.updater.install()).toEqual({
      ok: false,
      reason: "disk full",
    });
  });
});

describe("committed updater config", () => {
  const conf = JSON.parse(
    readFileSync(
      new URL("../src-tauri/tauri.conf.json", import.meta.url),
      "utf8",
    ),
  );

  it("carries the endpoint, a public key and the updater artifacts flag", () => {
    expect(conf.plugins.updater.endpoints).toEqual([
      "https://github.com/kenmclennan/recognizer-releases/releases/latest/download/latest.json",
    ]);
    expect(conf.plugins.updater.pubkey).not.toBe("");
    expect(conf.bundle.createUpdaterArtifacts).toBe(true);
    expect(conf.bundle.macOS.signingIdentity).toBe("-");
  });
});
