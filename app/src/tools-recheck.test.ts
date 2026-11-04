import { describe, expect, it } from "vitest";
import { createMessageTray } from "./message-tray";
import { postToolsMessage, TOOLS_KEY, type ToolsReport } from "./tools-notice";
import { createToolsRecheck } from "./tools-recheck";

const APP = "0.1.99";

function version(v: string): ToolsReport {
  return { status: "version", version: v };
}

function harness(reports: Array<ToolsReport | Error>) {
  let t = 0;
  let reads = 0;
  const queue = [...reports];
  const shown: Array<{ text: string | null; fresh: boolean }> = [];
  const recheck = createToolsRecheck({
    now: () => t,
    read: async () => {
      reads += 1;
      const next = queue.shift() as ToolsReport | Error;

      if (next instanceof Error) {
        throw next;
      }

      return { appVersion: APP, report: next };
    },
    show: (notice, fresh) => shown.push({ text: notice?.text ?? null, fresh }),
  });

  return {
    recheck,
    shown,
    reads: () => reads,
    at(ms: number) {
      t = ms;
    },
  };
}

describe("createToolsRecheck", () => {
  it("shows the older-command notice on open then clears it on a later focus", async () => {
    const h = harness([version("0.1.95"), version(APP)]);

    await h.recheck.onOpen();
    h.at(61_000);
    await h.recheck.onFocus();

    expect(h.shown).toEqual([
      {
        text: "The recognizer command (0.1.95) is older than the app (0.1.99)",
        fresh: true,
      },
      { text: null, fresh: true },
    ]);
  });

  it("reports a still-older command as fresh only on open", async () => {
    const h = harness(Array(5).fill(version("0.1.95")));

    await h.recheck.onOpen();

    for (let i = 1; i <= 4; i++) {
      h.at(i * 61_000);
      await h.recheck.onFocus();
    }

    expect(h.shown).toHaveLength(5);
    expect(new Set(h.shown.map((s) => s.text)).size).toBe(1);
    expect(h.shown.map((s) => s.fresh)).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it("holds a focus until the gap has passed", async () => {
    const h = harness([version(APP), version(APP)]);

    await h.recheck.onOpen();

    for (const ms of [10_000, 59_000, 59_999]) {
      h.at(ms);
      await h.recheck.onFocus();
    }

    expect(h.reads()).toBe(1);

    h.at(60_000);
    await h.recheck.onFocus();

    expect(h.reads()).toBe(2);
  });

  it("does not start a second read while one is in flight", async () => {
    const h = harness([version(APP), version(APP)]);
    const opening = h.recheck.onOpen();

    h.at(120_000);
    await h.recheck.onFocus();
    await opening;

    expect(h.reads()).toBe(1);
  });

  it("treats a rejected read as no notice and does not retry within the gap", async () => {
    const h = harness([new Error("boom"), version(APP)]);

    await h.recheck.onOpen();
    h.at(30_000);
    await h.recheck.onFocus();

    expect(h.shown).toEqual([{ text: null, fresh: true }]);
    expect(h.reads()).toBe(1);
  });

  it("posts again when the older version changes, then clears", async () => {
    const h = harness([version("0.1.95"), version("0.1.97"), version(APP)]);

    await h.recheck.onOpen();
    h.at(61_000);
    await h.recheck.onFocus();
    h.at(122_000);
    await h.recheck.onFocus();

    expect(
      h.shown.map((s) => [s.text?.includes("0.1.97") ?? s.text, s.fresh]),
    ).toEqual([
      [false, true],
      [true, true],
      [null, true],
    ]);
  });

  it("(non-gating) leaves one tray row, then none, wired as in main", async () => {
    const tray = createMessageTray(
      () => 0,
      () => () => {},
    );
    let t = 0;
    let found = false;
    const queue = [version("0.1.95"), version("0.1.95"), version(APP)];
    const recheck = createToolsRecheck({
      now: () => t,
      read: async () => ({
        appVersion: APP,
        report: queue.shift() as ToolsReport,
      }),
      show: (notice, fresh) => {
        found = notice !== null;

        if (notice !== null && fresh) {
          postToolsMessage(notice, tray, async () => {});
        }

        tray.reconcile(found ? [TOOLS_KEY] : []);
      },
    });
    const counts: number[] = [];

    await recheck.onOpen();
    counts.push(tray.snapshot().rows.length);
    t = 61_000;
    await recheck.onFocus();
    counts.push(tray.snapshot().rows.length);
    t = 122_000;
    await recheck.onFocus();
    counts.push(tray.snapshot().rows.length);

    expect(counts).toEqual([1, 1, 0]);
  });
});
