import { describe, expect, it } from "vitest";
import { readSetup } from "../../src/index.js";
import { ROOT, worldOf } from "./world.js";

const scan = (value: unknown) => JSON.stringify(value);

async function translated(lines: string[]): Promise<unknown[]> {
  const world = worldOf();
  const received: string[] = [];

  world.fakes.setupScan.lines = lines;

  await readSetup(world.ports, {
    root: ROOT,
    extract: true,
    onLine: (line) => received.push(line),
  });

  return received
    .map((line) => JSON.parse(line) as { event: string })
    .filter(({ event }) => event !== "step");
}

describe("readSetup scan line translation", () => {
  it("phase extract run with languages gives languages with names", async () => {
    expect(
      await translated([
        scan({
          event: "phase",
          phase: "extract",
          state: "run",
          commit: null,
          languages: ["python", "typescript"],
        }),
      ]),
    ).toEqual([{ event: "languages", names: ["python", "typescript"] }]);
  });

  it("phase extract run without languages gives languages with null names", async () => {
    expect(
      await translated([
        scan({ event: "phase", phase: "extract", state: "run", commit: null }),
      ]),
    ).toEqual([{ event: "languages", names: null }]);
  });

  it("phase extract current gives extract-current", async () => {
    expect(
      await translated([
        scan({
          event: "phase",
          phase: "extract",
          state: "current",
          commit: "a",
        }),
      ]),
    ).toEqual([{ event: "extract-current" }]);
  });

  it("plugin extract start gives language reading with the total of a files unit", async () => {
    expect(
      await translated([
        scan({
          event: "plugin",
          phase: "extract",
          name: "python",
          data: { event: "start", total: 120, unit: "files" },
        }),
        scan({
          event: "plugin",
          phase: "extract",
          name: "rust",
          data: { event: "start", total: 9, unit: "crates" },
        }),
      ]),
    ).toEqual([
      { event: "language", name: "python", state: "reading", files: 120 },
      { event: "language", name: "rust", state: "reading", files: null },
    ]);
  });

  it("plugin extract progress counts only a files unit", async () => {
    expect(
      await translated([
        scan({
          event: "plugin",
          phase: "extract",
          name: "python",
          data: { event: "progress", done: 1, total: 50, unit: "files" },
        }),
        scan({
          event: "plugin",
          phase: "extract",
          name: "python",
          data: { event: "progress", done: 1, total: 50, unit: "bytes" },
        }),
      ]),
    ).toEqual([
      { event: "language", name: "python", state: "reading", files: 50 },
    ]);
  });

  it("entry extract gives language done with no files", async () => {
    expect(
      await translated([
        scan({
          event: "entry",
          phase: "extract",
          name: "python",
          outcome: "ok",
        }),
      ]),
    ).toEqual([
      { event: "language", name: "python", state: "done", files: null },
    ]);
  });

  it("structure run gives duplication comparing", async () => {
    expect(
      await translated([scan({ event: "structure", state: "run" })]),
    ).toEqual([{ event: "duplication", state: "comparing", files: null }]);
  });

  it("structure done and failed give duplication with that state and the files", async () => {
    expect(
      await translated([
        scan({ event: "structure", state: "done", files: 125 }),
        scan({ event: "structure", state: "failed", files: 3 }),
      ]),
    ).toEqual([
      { event: "duplication", state: "done", files: 125 },
      { event: "duplication", state: "failed", files: 3 },
    ]);
  });

  it("every other line is dropped and never reaches onLine", async () => {
    expect(
      await translated([
        "not json",
        scan({ event: "preflight", state: "ok" }),
        scan({ event: "phase", phase: "describe", total: 3 }),
        scan({
          event: "entry",
          phase: "describe",
          name: "a.py",
          outcome: "ok",
        }),
        scan({ event: "summary", exit: 0, log: null }),
        scan({ event: "entry", phase: "extract", name: "rust", outcome: "ok" }),
        scan({ event: "structure", state: "bogus" }),
      ]),
    ).toEqual([
      { event: "language", name: "rust", state: "done", files: null },
    ]);
  });
});
