import { describe, expect, it } from "vitest";
import type { Io } from "../../src/cli.js";

export interface IoFilesSubject {
  io: Io;
  directory: string;
  modeOf(path: string): number | undefined;
}

interface Case {
  member: string;
  title: string;
  run: (s: IoFilesSubject, at: (name: string) => string) => void;
}

const ABC_SHA256 =
  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

const CASES: Case[] = [
  {
    member: "writeFile",
    title: "creates missing parent folders",
    run: (s, at) => {
      s.io.writeFile(at("a/b/c.txt"), "x");

      expect(s.io.exists(at("a/b"))).toBe(true);
      expect(s.io.readFile(at("a/b/c.txt"))).toBe("x");
    },
  },
  {
    member: "writeFile",
    title: "replaces the content of an existing file",
    run: (s, at) => {
      s.io.writeFile(at("f.txt"), "one");

      expect(s.io.readFile(at("f.txt"))).toBe("one");

      s.io.writeFile(at("f.txt"), "two");

      expect(s.io.readFile(at("f.txt"))).toBe("two");
    },
  },
  {
    member: "writeFile",
    title: "stores the given mode on creation",
    run: (s, at) => {
      s.io.writeFile(at("m.sh"), "x", 0o700);

      expect(s.modeOf(at("m.sh"))).toBe(0o700);
    },
  },
  {
    member: "writeFile",
    title: "keeps the existing mode when rewritten without one",
    run: (s, at) => {
      s.io.writeFile(at("m.sh"), "x", 0o700);

      expect(s.modeOf(at("m.sh"))).toBe(0o700);

      s.io.writeFile(at("m.sh"), "y");

      expect(s.io.readFile(at("m.sh"))).toBe("y");
      expect(s.modeOf(at("m.sh"))).toBe(0o700);
    },
  },
  {
    member: "writeFile",
    title: "throws when the path is an existing directory",
    run: (s, at) => {
      s.io.writeFile(at("d/inner.txt"), "x");

      expect(s.io.readDir(at("d")).map((entry) => entry.name)).toEqual([
        "inner.txt",
      ]);
      expect(() => s.io.writeFile(at("d"), "y")).toThrow();
      expect(s.io.readFile(at("d/inner.txt"))).toBe("x");
    },
  },
  {
    member: "writeFile",
    title: "throws when an ancestor is a file",
    run: (s, at) => {
      s.io.writeFile(at("f"), "x");

      expect(s.io.readFile(at("f"))).toBe("x");
      expect(() => s.io.writeFile(at("f/child.txt"), "y")).toThrow();
      expect(s.io.readFile(at("f"))).toBe("x");
    },
  },
  {
    member: "readFile",
    title: "round-trips multi-byte text",
    run: (s, at) => {
      s.io.writeFile(at("u.txt"), "héllo ✓");

      expect(s.io.readFile(at("u.txt"))).toBe("héllo ✓");
    },
  },
  {
    member: "readFile",
    title: "throws for a missing path",
    run: (s, at) => {
      expect(s.io.exists(at("nope"))).toBe(false);
      expect(() => s.io.readFile(at("nope"))).toThrow();
    },
  },
  {
    member: "readFile",
    title: "throws for a directory",
    run: (s, at) => {
      s.io.writeFile(at("d/x.txt"), "x");

      expect(s.io.exists(at("d"))).toBe(true);
      expect(() => s.io.readFile(at("d"))).toThrow();
    },
  },
  {
    member: "readBytes",
    title: "returns exactly the bytes of the written text",
    run: (s, at) => {
      s.io.writeFile(at("b.txt"), "héllo");

      expect([...s.io.readBytes(at("b.txt"))]).toEqual([
        ...Buffer.from("héllo", "utf8"),
      ]);
    },
  },
  {
    member: "readBytes",
    title: "throws for a missing path",
    run: (s, at) => {
      expect(s.io.exists(at("nope"))).toBe(false);
      expect(() => s.io.readBytes(at("nope"))).toThrow();
    },
  },
  {
    member: "readBytes",
    title: "throws for a directory",
    run: (s, at) => {
      s.io.writeFile(at("d/x.txt"), "x");

      expect(s.io.exists(at("d"))).toBe(true);
      expect(() => s.io.readBytes(at("d"))).toThrow();
    },
  },
  {
    member: "exists",
    title: "is true for a file and for a folder",
    run: (s, at) => {
      s.io.writeFile(at("d/f.txt"), "x");

      expect(s.io.exists(at("d/f.txt"))).toBe(true);
      expect(s.io.exists(at("d"))).toBe(true);
    },
  },
  {
    member: "exists",
    title: "is false for a missing path and after remove",
    run: (s, at) => {
      expect(s.io.exists(at("nope"))).toBe(false);

      s.io.writeFile(at("f.txt"), "x");

      expect(s.io.exists(at("f.txt"))).toBe(true);

      s.io.remove(at("f.txt"));

      expect(s.io.exists(at("f.txt"))).toBe(false);
    },
  },
  {
    member: "hashFile",
    title: "is the sha256 of the content",
    run: (s, at) => {
      s.io.writeFile(at("h.txt"), "abc");

      expect(s.io.hashFile(at("h.txt"))).toBe(ABC_SHA256);
    },
  },
  {
    member: "hashFile",
    title: "is null for a missing path",
    run: (s, at) => {
      expect(s.io.exists(at("nope"))).toBe(false);
      expect(s.io.hashFile(at("nope"))).toBeNull();
    },
  },
  {
    member: "hashFile",
    title: "is null for a directory",
    run: (s, at) => {
      s.io.writeFile(at("d/x.txt"), "x");

      expect(s.io.exists(at("d"))).toBe(true);
      expect(s.io.hashFile(at("d"))).toBeNull();
    },
  },
  {
    member: "rename",
    title: "replaces an existing target",
    run: (s, at) => {
      s.io.writeFile(at("from.txt"), "new");
      s.io.writeFile(at("to.txt"), "old");

      expect(s.io.readFile(at("to.txt"))).toBe("old");

      s.io.rename(at("from.txt"), at("to.txt"));

      expect(s.io.readFile(at("to.txt"))).toBe("new");
      expect(s.io.exists(at("from.txt"))).toBe(false);
    },
  },
  {
    member: "rename",
    title: "moves a directory with its contents and leaves no source",
    run: (s, at) => {
      s.io.writeFile(at("old/sub/n.txt"), "nested");
      s.io.writeFile(at("old/top.txt"), "top");

      expect(s.io.exists(at("old/sub/n.txt"))).toBe(true);

      s.io.rename(at("old"), at("new"));

      expect(s.io.readFile(at("new/sub/n.txt"))).toBe("nested");
      expect(s.io.readFile(at("new/top.txt"))).toBe("top");
      expect(s.io.exists(at("old"))).toBe(false);
    },
  },
  {
    member: "rename",
    title: "keeps the file's mode",
    run: (s, at) => {
      s.io.writeFile(at("a.sh"), "x", 0o700);

      expect(s.modeOf(at("a.sh"))).toBe(0o700);

      s.io.rename(at("a.sh"), at("b.sh"));

      expect(s.modeOf(at("b.sh"))).toBe(0o700);
    },
  },
  {
    member: "rename",
    title: "throws for a missing source",
    run: (s, at) => {
      expect(s.io.exists(at("nope"))).toBe(false);
      expect(() => s.io.rename(at("nope"), at("to.txt"))).toThrow();
      expect(s.io.exists(at("to.txt"))).toBe(false);
    },
  },
  {
    member: "rename",
    title: "throws when the target's folder is missing",
    run: (s, at) => {
      s.io.writeFile(at("from.txt"), "x");

      expect(s.io.exists(at("from.txt"))).toBe(true);
      expect(() => s.io.rename(at("from.txt"), at("gone/to.txt"))).toThrow();
      expect(s.io.exists(at("gone"))).toBe(false);
      expect(s.io.exists(at("from.txt"))).toBe(true);
    },
  },
  {
    member: "readDir",
    title: "lists names and kinds, compared sorted",
    run: (s, at) => {
      s.io.writeFile(at("d/file.txt"), "x");
      s.io.writeFile(at("d/sub/inner.txt"), "y");

      const entries = s.io
        .readDir(at("d"))
        .map((entry) => `${entry.name}:${entry.kind}`)
        .sort();

      expect(entries).toEqual(["file.txt:file", "sub:directory"]);
    },
  },
  {
    member: "readDir",
    title: "is empty for a folder emptied by remove",
    run: (s, at) => {
      s.io.writeFile(at("d/f.txt"), "x");

      expect(s.io.readDir(at("d"))).toHaveLength(1);

      s.io.remove(at("d/f.txt"));

      expect(s.io.readDir(at("d"))).toEqual([]);
    },
  },
  {
    member: "readDir",
    title: "lists a folder created by a nested write as a directory",
    run: (s, at) => {
      s.io.writeFile(at("d/a/b/c.txt"), "x");

      expect(s.io.readDir(at("d/a"))).toEqual([
        { name: "b", kind: "directory" },
      ]);
    },
  },
  {
    member: "readDir",
    title: "throws for a missing path",
    run: (s, at) => {
      expect(s.io.exists(at("nope"))).toBe(false);
      expect(() => s.io.readDir(at("nope"))).toThrow();
    },
  },
  {
    member: "readDir",
    title: "throws for a file",
    run: (s, at) => {
      s.io.writeFile(at("f.txt"), "x");

      expect(s.io.exists(at("f.txt"))).toBe(true);
      expect(() => s.io.readDir(at("f.txt"))).toThrow();
    },
  },
  {
    member: "remove",
    title: "deletes a file and keeps its sibling",
    run: (s, at) => {
      s.io.writeFile(at("d/a.txt"), "a");
      s.io.writeFile(at("d/b.txt"), "b");

      expect(s.io.exists(at("d/b.txt"))).toBe(true);

      s.io.remove(at("d/a.txt"));

      expect(s.io.exists(at("d/a.txt"))).toBe(false);
      expect(s.io.exists(at("d/b.txt"))).toBe(true);
    },
  },
  {
    member: "remove",
    title: "is a no-op for a missing path",
    run: (s, at) => {
      expect(s.io.exists(at("nope"))).toBe(false);
      expect(() => s.io.remove(at("nope"))).not.toThrow();
    },
  },
  {
    member: "remove",
    title: "throws for a directory and leaves its contents",
    run: (s, at) => {
      s.io.writeFile(at("d/x.txt"), "x");

      expect(s.io.exists(at("d/x.txt"))).toBe(true);
      expect(() => s.io.remove(at("d"))).toThrow();
      expect(s.io.readFile(at("d/x.txt"))).toBe("x");
    },
  },
  {
    member: "makeTempDir",
    title: "returns an existing empty folder with the scan prefix",
    run: (s) => {
      const first = s.io.makeTempDir();
      const second = s.io.makeTempDir();

      try {
        expect(first.split("/").at(-1)).toMatch(/^recognizer-scan-/);
        expect(s.io.exists(first)).toBe(true);
        expect(s.io.readDir(first)).toEqual([]);
        expect(second).not.toBe(first);
      } finally {
        s.io.removeDir(first);
        s.io.removeDir(second);
      }
    },
  },
  {
    member: "removeDir",
    title: "removes a folder and everything under it",
    run: (s, at) => {
      s.io.writeFile(at("d/a/b.txt"), "x");

      expect(s.io.exists(at("d/a/b.txt"))).toBe(true);

      s.io.removeDir(at("d"));

      expect(s.io.exists(at("d"))).toBe(false);
      expect(s.io.exists(at("d/a/b.txt"))).toBe(false);
    },
  },
  {
    member: "removeDir",
    title: "is a no-op for a missing path",
    run: (s, at) => {
      expect(s.io.exists(at("nope"))).toBe(false);
      expect(() => s.io.removeDir(at("nope"))).not.toThrow();
    },
  },
  {
    member: "removeDir",
    title: "leaves a sibling whose name starts with the removed name",
    run: (s, at) => {
      s.io.writeFile(at("d/x.txt"), "x");
      s.io.writeFile(at("d2/y.txt"), "y");

      s.io.removeDir(at("d"));

      expect(s.io.exists(at("d"))).toBe(false);
      expect(s.io.readFile(at("d2/y.txt"))).toBe("y");
    },
  },
  {
    member: "modified",
    title: "is null for a missing path",
    run: (s, at) => {
      expect(s.io.exists(at("nope"))).toBe(false);
      expect(s.io.modified?.(at("nope"))).toBeNull();
    },
  },
  {
    member: "modified",
    title: "is a number for a file after a write",
    run: (s, at) => {
      s.io.writeFile(at("f.txt"), "x");

      expect(typeof s.io.modified?.(at("f.txt"))).toBe("number");
    },
  },
  {
    member: "modified",
    title: "does not fall after a second write",
    run: (s, at) => {
      s.io.writeFile(at("f.txt"), "x");

      const first = s.io.modified?.(at("f.txt")) as number;

      s.io.writeFile(at("f.txt"), "y");

      expect(typeof first).toBe("number");
      expect(s.io.modified?.(at("f.txt")) as number).toBeGreaterThanOrEqual(
        first,
      );
    },
  },
  {
    member: "createExclusive",
    title: "returns true and creates missing parent folders for a new path",
    run: (s, at) => {
      expect(s.io.exists(at("a/b"))).toBe(false);
      expect(s.io.createExclusive(at("a/b/x.txt"), "one")).toBe(true);
      expect(s.io.readFile(at("a/b/x.txt"))).toBe("one");
    },
  },
  {
    member: "createExclusive",
    title: "returns false and keeps the content for an existing file",
    run: (s, at) => {
      s.io.writeFile(at("x.txt"), "one");

      expect(s.io.createExclusive(at("x.txt"), "two")).toBe(false);
      expect(s.io.readFile(at("x.txt"))).toBe("one");
    },
  },
  {
    member: "createExclusive",
    title: "returns false for a directory and leaves it a directory",
    run: (s, at) => {
      s.io.writeFile(at("d/x.txt"), "x");

      expect(s.io.exists(at("d"))).toBe(true);
      expect(s.io.createExclusive(at("d"), "y")).toBe(false);
      expect(s.io.readDir(at("d")).map((entry) => entry.name)).toEqual([
        "x.txt",
      ]);
    },
  },
  {
    member: "append",
    title: "creates a missing file",
    run: (s, at) => {
      expect(s.io.exists(at("log.txt"))).toBe(false);

      s.io.append(at("log.txt"), "a");

      expect(s.io.readFile(at("log.txt"))).toBe("a");
    },
  },
  {
    member: "append",
    title: "adds to the end of an existing file and keeps its mode",
    run: (s, at) => {
      s.io.writeFile(at("log.txt"), "a", 0o700);

      expect(s.modeOf(at("log.txt"))).toBe(0o700);

      s.io.append(at("log.txt"), "b");
      s.io.append(at("log.txt"), "c");

      expect(s.io.readFile(at("log.txt"))).toBe("abc");
      expect(s.modeOf(at("log.txt"))).toBe(0o700);
    },
  },
  {
    member: "append",
    title: "throws when the file's folder is missing",
    run: (s, at) => {
      expect(s.io.exists(at("gone"))).toBe(false);
      expect(() => s.io.append(at("gone/log.txt"), "a")).toThrow();
      expect(s.io.exists(at("gone"))).toBe(false);
    },
  },
  {
    member: "stamp",
    title: "is 0:0 for a missing path",
    run: (s, at) => {
      expect(s.io.exists(at("nope"))).toBe(false);
      expect(s.io.stamp(at("nope"))).toBe("0:0");
    },
  },
  {
    member: "stamp",
    title: "is the same value twice with no change between",
    run: (s, at) => {
      s.io.writeFile(at("s.txt"), "a");

      const first = s.io.stamp(at("s.txt"));

      expect(first).not.toBe("0:0");
      expect(s.io.stamp(at("s.txt"))).toBe(first);
    },
  },
  {
    member: "stamp",
    title: "is a different value after the size changes",
    run: (s, at) => {
      s.io.writeFile(at("s.txt"), "a");

      const first = s.io.stamp(at("s.txt"));

      s.io.writeFile(at("s.txt"), "abcd");

      expect(s.io.stamp(at("s.txt"))).not.toBe(first);
    },
  },
];

export const FILE_MEMBERS_COVERED: ReadonlySet<string> = new Set(
  CASES.map((entry) => entry.member),
);

export function ioFilesContract(
  title: string,
  subject: () => IoFilesSubject,
): void {
  describe(title, () => {
    for (const entry of CASES) {
      it(`${entry.member}: ${entry.title}`, () => {
        const s = subject();

        entry.run(s, (name) => `${s.directory}/${name}`);
      });
    }
  });
}
