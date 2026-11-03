import { describe, expect, it } from "vitest";
import {
  createMessageTray,
  type MessageInput,
  type SetTimer,
  TOAST_MS,
  timeLabel,
} from "./message-tray";

function harness() {
  const clock = { now: 1_000_000 };
  const timers: { run: () => void; ms: number; live: boolean }[] = [];
  const setTimer: SetTimer = (run, ms) => {
    const timer = { run, ms, live: true };

    timers.push(timer);

    return () => {
      timer.live = false;
    };
  };
  const tray = createMessageTray(() => clock.now, setTimer);

  return { clock, timers, tray };
}

const warning: MessageInput = { kind: "warning", text: "careful" };
const done: MessageInput = { kind: "done", text: "saved" };

describe("message tray", () => {
  it("lists messages newest first", () => {
    const { tray } = harness();

    tray.post({ kind: "done", text: "first" });
    tray.post({ kind: "info", text: "second" });

    expect(tray.snapshot().rows.map((row) => row.text)).toEqual([
      "second",
      "first",
    ]);
  });

  describe("badge", () => {
    it("is hidden when the tray is empty", () => {
      const { tray } = harness();

      expect(tray.snapshot().badge.hidden).toBe(true);
    });

    it("is amber and counts one unread warning", () => {
      const { tray } = harness();

      tray.post(warning);

      expect(tray.snapshot().badge).toEqual({
        count: 1,
        tone: "amber",
        hidden: false,
      });
    });

    it("is amber for an unread error", () => {
      const { tray } = harness();

      tray.post({ kind: "error", text: "broke" });

      expect(tray.snapshot().badge.tone).toBe("amber");
    });

    it("is grey and counts one unread done message", () => {
      const { tray } = harness();

      tray.post(done);

      expect(tray.snapshot().badge).toEqual({
        count: 1,
        tone: "grey",
        hidden: false,
      });
    });

    it("shows the total in grey when every message is read", () => {
      const { tray } = harness();

      tray.post(warning);
      tray.post(done);
      tray.open();
      tray.close();

      expect(tray.snapshot().badge).toEqual({
        count: 2,
        tone: "grey",
        hidden: false,
      });
    });

    it("counts only the unread among read and unread", () => {
      const { tray } = harness();

      tray.post(done);
      tray.open();
      tray.close();
      tray.post(done);
      tray.post(done);

      expect(tray.snapshot().badge.count).toBe(2);
    });
  });

  describe("read state", () => {
    it("marks every message read on open while the drawn rows keep their unread text", () => {
      const { tray } = harness();

      tray.post(warning);
      tray.open();

      const open = tray.snapshot();

      expect(open.badge.tone).toBe("grey");
      expect(open.rows.map((row) => row.unread)).toEqual([true]);

      tray.close();

      expect(tray.snapshot().rows.map((row) => row.unread)).toEqual([false]);
    });

    it("draws the messages read on the second opening", () => {
      const { tray } = harness();

      tray.post(warning);
      tray.open();
      tray.close();
      tray.open();

      expect(tray.snapshot().rows.map((row) => row.unread)).toEqual([false]);
    });

    it("empties the tray and hides the badge on clear", () => {
      const { tray } = harness();

      tray.post(warning);
      tray.open();
      tray.clear();

      const snapshot = tray.snapshot();

      expect(snapshot.rows).toEqual([]);
      expect(snapshot.badge.hidden).toBe(true);
    });
  });

  describe("dedupe", () => {
    it("drops a keyed post while the key is present and does not toast", () => {
      const { tray, timers } = harness();

      expect(tray.post({ ...warning, key: "tools-version" })).not.toBeNull();
      timers[0]?.run();

      expect(tray.post({ ...warning, key: "tools-version" })).toBeNull();
      expect(tray.snapshot().rows).toHaveLength(1);
      expect(tray.snapshot().toast).toBeNull();
      expect(timers).toHaveLength(1);
    });

    it("drops a keyed post even when the first one is read", () => {
      const { tray } = harness();

      tray.post({ ...warning, key: "k" });
      tray.open();
      tray.close();

      expect(tray.post({ ...warning, key: "k" })).toBeNull();
    });

    it("posts the key again after clear", () => {
      const { tray } = harness();

      tray.post({ ...warning, key: "k" });
      tray.clear();

      expect(tray.post({ ...warning, key: "k" })).not.toBeNull();
      expect(tray.snapshot().rows).toHaveLength(1);
    });

    it("never dedupes an unkeyed message", () => {
      const { tray } = harness();

      tray.post(done);
      tray.post(done);

      expect(tray.snapshot().rows).toHaveLength(2);
    });
  });

  describe("toast", () => {
    it("shows for exactly 3500 ms on the handed timer", () => {
      const { tray, timers } = harness();

      tray.post(done);

      expect(timers[0]?.ms).toBe(3500);
      expect(TOAST_MS).toBe(3500);
      expect(tray.snapshot().toast?.text).toBe("saved");

      timers[0]?.run();

      expect(tray.snapshot().toast).toBeNull();
      expect(tray.snapshot().rows).toHaveLength(1);
    });

    it("is replaced by a newer post and the old timer is cancelled", () => {
      const { tray, timers } = harness();

      tray.post({ kind: "done", text: "one" });
      tray.post({ kind: "done", text: "two" });

      expect(timers[0]?.live).toBe(false);
      expect(timers[1]?.live).toBe(true);
      expect(tray.snapshot().toast?.text).toBe("two");
    });

    it("is hidden when the tray opens", () => {
      const { tray, timers } = harness();

      tray.post(done);
      tray.open();

      expect(tray.snapshot().toast).toBeNull();
      expect(timers[0]?.live).toBe(false);
    });

    it("does not toast a message posted into an open tray", () => {
      const { tray, timers } = harness();

      tray.open();
      tray.post(done);

      expect(tray.snapshot().toast).toBeNull();
      expect(timers).toHaveLength(0);
    });

    it("is hidden after its action runs", () => {
      const { tray } = harness();
      let ran = 0;
      const id = tray.post({
        ...done,
        action: {
          label: "Undo",
          run: () => {
            ran += 1;
          },
        },
      });

      tray.act(id as number);

      expect(ran).toBe(1);
      expect(tray.snapshot().toast).toBeNull();
    });
  });

  describe("time label", () => {
    it.each([
      [0, "just now"],
      [59_000, "just now"],
      [60_000, "1 min ago"],
      [119_000, "1 min ago"],
      [59 * 60_000, "59 min ago"],
      [60 * 60_000, "1 h ago"],
      [23 * 3_600_000, "23 h ago"],
      [24 * 3_600_000, "1 d ago"],
    ])("labels an age of %i ms as %s", (age, label) => {
      expect(timeLabel(age)).toBe(label);
    });

    it("draws the label from the post time", () => {
      const { clock, tray } = harness();

      tray.post(done);
      clock.now += 120_000;

      expect(tray.snapshot().rows[0]?.when).toBe("2 min ago");
    });

    it("forces on open for a condition found while loading", () => {
      const { clock, tray } = harness();

      tray.post({ ...warning, onOpen: true });
      clock.now += 5 * 3_600_000;

      expect(tray.snapshot().rows[0]?.when).toBe("on open");
    });
  });

  describe("toast boundary", () => {
    it("is shown at 3499 ms and hidden at 3500 ms", () => {
      const { tray, timers } = harness();

      tray.post(done);

      const timer = timers[0];

      expect(timer?.live).toBe(true);
      expect(tray.snapshot().toast).not.toBeNull();

      timer?.run();

      expect(tray.snapshot().toast).toBeNull();
    });
  });

  describe("actions", () => {
    it("withdraws an action and keeps the text", () => {
      const { tray } = harness();
      const first = tray.post({
        ...done,
        text: "first",
        action: { label: "Undo", run: () => {} },
      });

      tray.post({
        ...done,
        text: "second",
        action: { label: "Undo", run: () => {} },
      });
      tray.withdraw(first as number);

      const rows = tray.snapshot().rows;

      expect(rows.map((row) => [row.text, row.action])).toEqual([
        ["second", "Undo"],
        ["first", null],
      ]);
    });

    it("relabels an action and makes it inert", () => {
      const { tray } = harness();
      let ran = 0;
      const id = tray.post({
        kind: "warning",
        text: "old",
        action: {
          label: "Upgrade",
          run: () => {
            ran += 1;
          },
        },
      }) as number;

      tray.relabel(id, "Copied");
      tray.act(id);

      expect(tray.snapshot().rows[0]?.action).toBe("Copied");
      expect(ran).toBe(0);
    });
  });

  describe("reconcile", () => {
    it("removes every keyed message and leaves unkeyed ones for no found keys", () => {
      const { tray } = harness();

      tray.post({ ...warning, key: "a" });
      tray.post({ ...warning, key: "b" });
      tray.post(done);
      tray.reconcile([]);

      expect(tray.snapshot().rows.map((row) => row.text)).toEqual(["saved"]);
    });

    it("keeps a present key and posts nothing", () => {
      const { tray } = harness();

      tray.post({ ...warning, key: "a" });
      tray.reconcile(["a"]);

      expect(tray.snapshot().rows).toHaveLength(1);
    });

    it("leaves exactly the two found of three keyed messages", () => {
      const { tray } = harness();

      tray.post({ ...warning, text: "a", key: "a" });
      tray.post({ ...warning, text: "b", key: "b" });
      tray.post({ ...warning, text: "c", key: "c" });
      tray.reconcile(["a", "c"]);

      expect(tray.snapshot().rows.map((row) => row.text)).toEqual(["c", "a"]);
    });

    it("hides the toast when it was the removed message", () => {
      const { tray } = harness();

      tray.post({ ...warning, key: "a" });
      tray.reconcile([]);

      expect(tray.snapshot().toast).toBeNull();
    });

    it("removes a read message and recomputes the badge", () => {
      const { tray } = harness();

      tray.post({ ...warning, key: "a" });
      tray.open();
      tray.close();
      tray.reconcile([]);

      expect(tray.snapshot().badge.hidden).toBe(true);
    });

    it("keeps the toast when the removed message was another", () => {
      const { tray } = harness();

      tray.post({ ...warning, key: "a" });
      tray.post(done);
      tray.reconcile([]);

      expect(tray.snapshot().toast?.text).toBe("saved");
    });
  });

  it("notifies subscribers on each change until they unsubscribe", () => {
    const { tray } = harness();
    let calls = 0;
    const stop = tray.subscribe(() => {
      calls += 1;
    });

    tray.post(done);
    stop();
    tray.post(done);

    expect(calls).toBe(1);
  });
});
