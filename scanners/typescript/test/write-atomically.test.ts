import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../scripts/temp-dirs.mjs";
import { writeAtomically } from "../src/cli.js";

describe("writeAtomically", () => {
  it("replaces the target by renaming a temporary file over it", () => {
    const dir = makeTempDir("write-atomically-");
    const target = join(dir, "scan.json");
    writeFileSync(target, "previous");
    const inode = statSync(target).ino;

    writeAtomically(target, "next");

    expect(readFileSync(target, "utf8")).toBe("next");
    expect(statSync(target).ino).not.toBe(inode);
    expect(readdirSync(dir)).toEqual(["scan.json"]);
  });

  it("leaves no temporary file behind when the rename fails", () => {
    const dir = makeTempDir("write-atomically-");
    const target = join(dir, "scan.json");
    mkdirSync(join(target, "inner"), { recursive: true });

    expect(() => writeAtomically(target, "next")).toThrow();
    expect(readdirSync(dir)).toEqual(["scan.json"]);
  });
});
