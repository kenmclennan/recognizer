import { describe, expect, it } from "vitest";
import type { Io } from "../../src/cli.js";

export interface IoTimersSubject {
  io: Io;
  elapse(ms: number): Promise<void>;
}

interface Case {
  member: string;
  title: string;
  run: (s: IoTimersSubject) => Promise<void>;
}

const CASES: Case[] = [
  {
    member: "now",
    title: "is epoch milliseconds",
    run: async (s) => {
      const value = s.io.now();

      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThan(1e12);
    },
  },
  {
    member: "now",
    title: "grows by at least 90 across 100 ms and never falls",
    run: async (s) => {
      const before = s.io.now();

      await s.elapse(100);

      expect(s.io.now() - before).toBeGreaterThanOrEqual(90);
    },
  },
  {
    member: "awake",
    title: "is a finite number",
    run: async (s) => {
      expect(Number.isFinite(s.io.awake())).toBe(true);
    },
  },
  {
    member: "awake",
    title: "grows by at least 90 across 100 ms and never falls",
    run: async (s) => {
      const before = s.io.awake();

      await s.elapse(100);

      expect(s.io.awake() - before).toBeGreaterThanOrEqual(90);
    },
  },
  {
    member: "after",
    title: "does not run synchronously, even for a delay of 0, and runs once",
    run: async (s) => {
      const fired: string[] = [];

      s.io.after(0, () => fired.push("zero"));

      expect(fired).toEqual([]);

      await s.elapse(50);
      await s.elapse(50);

      expect(fired).toEqual(["zero"]);
    },
  },
  {
    member: "after",
    title: "cancel after the action ran, and twice, is harmless",
    run: async (s) => {
      const fired: string[] = [];
      const cancel = s.io.after(10, () => fired.push("ran"));

      await s.elapse(100);
      await s.elapse(50);

      expect(fired).toEqual(["ran"]);

      cancel();
      cancel();
      await s.elapse(50);

      expect(fired).toEqual(["ran"]);
    },
  },
  {
    member: "after",
    title: "runs two timers of the same delay in the order scheduled",
    run: async (s) => {
      const fired: string[] = [];

      s.io.after(20, () => fired.push("first"));
      s.io.after(20, () => fired.push("second"));
      await s.elapse(100);
      await s.elapse(50);

      expect(fired).toEqual(["first", "second"]);
    },
  },
  {
    member: "after",
    title: "runs a timer scheduled by an action within the same elapse",
    run: async (s) => {
      const fired: string[] = [];

      s.io.after(10, () => {
        fired.push("outer");
        s.io.after(10, () => fired.push("inner"));
      });
      await s.elapse(200);
      await s.elapse(50);

      expect(fired).toEqual(["outer", "inner"]);
    },
  },
  {
    member: "wait",
    title: "resolves after the time passes, in due order with after",
    run: async (s) => {
      const done: string[] = [];

      void s.io.wait(10).then(() => done.push("wait"));
      s.io.after(80, () => done.push("after"));
      await s.elapse(40);
      await s.elapse(200);
      await s.elapse(50);

      expect(done).toEqual(["wait", "after"]);
    },
  },
];

export const TIMER_MEMBERS_COVERED: ReadonlySet<string> = new Set(
  CASES.map((entry) => entry.member),
);

export function ioTimersContract(
  title: string,
  subject: () => IoTimersSubject,
): void {
  describe(title, () => {
    for (const entry of CASES) {
      it(`${entry.member}: ${entry.title}`, async () => {
        await entry.run(subject());
      });
    }
  });
}
