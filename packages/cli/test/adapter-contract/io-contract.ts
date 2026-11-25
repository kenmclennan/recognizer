import { describe, expect, it } from "vitest";
import type { Io } from "../../src/cli.js";

export type Behaviour =
  | { kind: "exit"; status: number; stdout: string; stderr: string }
  | { kind: "hold" };

export interface IoSubject {
  io: Io;
  directory: string;
  program(name: string, behaviour: Behaviour): string;
  elapse(ms: number): Promise<void>;
}

export function ioContract(
  title: string,
  subject: () => IoSubject,
  teardown: () => void = () => {},
): void {
  const at = (s: IoSubject, name: string) => `${s.directory}/${name}`;

  describe(title, () => {
    it("a written file reads back", () => {
      const s = subject();

      s.io.writeFile(at(s, "a/b.txt"), "hello");

      expect(s.io.exists(at(s, "a/b.txt"))).toBe(true);
      expect(s.io.readFile(at(s, "a/b.txt"))).toBe("hello");
      expect(s.io.readBytes(at(s, "a/b.txt")).toString()).toBe("hello");
      teardown();
    });

    it("reading a missing file throws", () => {
      const s = subject();

      expect(s.io.exists(at(s, "nope.txt"))).toBe(false);
      expect(() => s.io.readFile(at(s, "nope.txt"))).toThrow();
      teardown();
    });

    it("rename replaces an existing target", () => {
      const s = subject();

      s.io.writeFile(at(s, "from.txt"), "new");
      s.io.writeFile(at(s, "to.txt"), "old");
      s.io.rename(at(s, "from.txt"), at(s, "to.txt"));

      expect(s.io.readFile(at(s, "to.txt"))).toBe("new");
      expect(s.io.exists(at(s, "from.txt"))).toBe(false);
      teardown();
    });

    it("createExclusive refuses an existing file and writes a new one", () => {
      const s = subject();

      expect(s.io.createExclusive(at(s, "x.txt"), "one")).toBe(true);
      expect(s.io.createExclusive(at(s, "x.txt"), "two")).toBe(false);
      expect(s.io.readFile(at(s, "x.txt"))).toBe("one");
      teardown();
    });

    it("append adds to the end", () => {
      const s = subject();

      s.io.writeFile(at(s, "log.txt"), "a");
      s.io.append(at(s, "log.txt"), "b");
      s.io.append(at(s, "log.txt"), "c");

      expect(s.io.readFile(at(s, "log.txt"))).toBe("abc");
      teardown();
    });

    it("readDir lists names and kinds (compared sorted)", () => {
      const s = subject();

      s.io.writeFile(at(s, "d/file.txt"), "x");
      s.io.writeFile(at(s, "d/sub/inner.txt"), "y");

      const entries = s.io
        .readDir(at(s, "d"))
        .map((entry) => `${entry.name}:${entry.kind}`)
        .sort();

      expect(entries).toEqual(["file.txt:file", "sub:directory"]);
      teardown();
    });

    it("hashFile is null for a missing file and changes with the content", () => {
      const s = subject();

      expect(s.io.hashFile(at(s, "h.txt"))).toBeNull();

      s.io.writeFile(at(s, "h.txt"), "one");

      const first = s.io.hashFile(at(s, "h.txt"));

      s.io.writeFile(at(s, "h.txt"), "two");

      expect(first).toMatch(/^[0-9a-f]{64}$/);
      expect(s.io.hashFile(at(s, "h.txt"))).not.toBe(first);
      teardown();
    });

    it("stamp is 0:0 for a missing file and changes when the size changes", () => {
      const s = subject();

      expect(s.io.stamp(at(s, "s.txt"))).toBe("0:0");

      s.io.writeFile(at(s, "s.txt"), "a");

      const first = s.io.stamp(at(s, "s.txt"));

      s.io.writeFile(at(s, "s.txt"), "abcd");

      expect(first).toMatch(/^\d+:1$/);
      expect(s.io.stamp(at(s, "s.txt"))).toMatch(/^\d+:4$/);
      expect(s.io.stamp(at(s, "s.txt"))).not.toBe(first);
      teardown();
    });

    it("run reports the status and both streams of a program", () => {
      const s = subject();
      const command = s.program("speak", {
        kind: "exit",
        status: 3,
        stdout: "out",
        stderr: "err",
      });
      const result = s.io.run(command, []);

      expect(result.status).toBe(3);
      expect(result.stdout).toBe("out");
      expect(result.stderr).toBe("err");
      expect(result.started).toBe(true);
      teardown();
    });

    it("run of a program that is not there reports started false", () => {
      const s = subject();
      const result = s.io.run(at(s, "no-such-program"), []);

      expect(result.started).toBe(false);
      teardown();
    });

    it("run with a timeout reports timedOut", () => {
      const s = subject();
      const command = s.program("slow", { kind: "hold" });
      const result = s.io.run(command, [], { timeoutMs: 200 });

      expect(result.timedOut).toBe(true);
      expect(result.status).not.toBe(0);
      teardown();
    });

    it("runAsync kill reports stopped", async () => {
      const s = subject();
      const command = s.program("hold", { kind: "hold" });
      const running = s.io.runAsync(command, []);

      await s.elapse(100);
      await s.io.scope?.stop(143, 500);

      const result = await running.result;

      expect(result.started).toBe(true);
      expect(result.stopped).toBe(true);
      expect(result.status).not.toBe(0);
      teardown();
    });

    it("after fires once after the delay and not after its cancel", async () => {
      const s = subject();
      const fired: string[] = [];

      s.io.after(50, () => fired.push("kept"));

      const cancel = s.io.after(50, () => fired.push("cancelled"));

      cancel();
      await s.elapse(20);

      expect(fired).toEqual([]);

      await s.elapse(100);
      await s.elapse(100);

      expect(fired).toEqual(["kept"]);
    });

    it("after fires in due order", async () => {
      const s = subject();
      const fired: string[] = [];

      s.io.after(60, () => fired.push("late"));
      s.io.after(10, () => fired.push("early"));
      await s.elapse(200);

      expect(fired).toEqual(["early", "late"]);
    });
  });
}
