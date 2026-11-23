import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO } from "./helpers.js";

const SRC = join(REPO, "packages/cli/src");
const REMOVED = [
  "views.ts",
  "view-staleness.ts",
  "neighbours.ts",
  "callers.ts",
  "paths.ts",
  "notes-order.ts",
  "git-range.ts",
];
const MOVED_NAMES = [
  "usesOf",
  "usedByOf",
  "shortestPath",
  "buildCallerIndex",
  "resolveView",
  "viewNotes",
  "staleReasons",
  "moveNote",
];
const COMMANDS = ["views-command.ts", "question-commands.ts"];
const OFFENDING = /new Set\(moduleNames/;

function offends(text: string): boolean {
  return (
    OFFENDING.test(text) ||
    REMOVED.some((file) => text.includes(`./${file.replace(/\.ts$/, ".js")}`))
  );
}

describe("the CLI holds no view logic", () => {
  it("has none of the moved modules", () => {
    expect(REMOVED.length).toBeGreaterThan(0);
    expect(REMOVED.filter((file) => existsSync(join(SRC, file)))).toEqual([]);
  });

  it("exports none of the moved names from the index", () => {
    const index = readFileSync(join(SRC, "index.ts"), "utf8");

    expect(
      MOVED_NAMES.filter((name) => new RegExp(`\\b${name}\\b`).test(index)),
    ).toEqual([]);
  });

  it("keeps the command files free of the removed modules and set-building logic", () => {
    expect(COMMANDS.length).toBeGreaterThan(0);

    for (const file of COMMANDS) {
      expect(offends(readFileSync(join(SRC, file), "utf8")), file).toBe(false);
    }
  });

  it("the matcher flags a known offending string", () => {
    expect(offends('import { x } from "./neighbours.js";')).toBe(true);
    expect(offends("const k = new Set(moduleNames(repository));")).toBe(true);
    expect(offends("const k = 1;")).toBe(false);
  });
});
