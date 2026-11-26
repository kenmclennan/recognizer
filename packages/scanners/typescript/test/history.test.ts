import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../../tools/scripts/temp-dirs.mjs";
import { run } from "../src/cli.js";
import { progressTo } from "../src/events.js";
import { historyPath } from "../src/history.js";
import { FIXTURE, makeTree, PACKAGE } from "./helpers.js";

type Event = Record<string, unknown>;

function treeOf(count: number): string {
  const files: Record<string, string> = {};

  for (let number = 0; number < count; number += 1) {
    files[`m${number}.ts`] = "export const a = 1;\n";
  }

  return makeTree(files);
}

function seed(root: string, runs: unknown): string {
  const path = historyPath(root);

  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(
    path,
    typeof runs === "string" ? runs : JSON.stringify({ runs }),
  );

  return path;
}

function eventsOf(lines: string[]): Event[] {
  return lines
    .join("")
    .split("\n")
    .filter((line) => line.startsWith("recognizer-event "))
    .map((line) => JSON.parse(line.slice("recognizer-event ".length)) as Event);
}

function scanRoot(root: string): {
  status: number;
  events: Event[];
  out: string;
} {
  const err: string[] = [];
  const out: string[] = [];
  const status = run(["run", root], {
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    writeFile: () => {},
  });

  return { status, events: eventsOf(err), out: out.join("") };
}

function stored(root: string): { key: string; ms: number; units: number }[] {
  return JSON.parse(readFileSync(historyPath(root), "utf8")).runs;
}

function clocked() {
  const clock = { now: 0 };
  const lines: string[] = [];

  return { clock, lines, read: () => clock.now };
}

const SEED = [{ key: "run", ms: 4000, units: 200 }];

function estimates(events: Event[]): Event[] {
  return events.filter((event) => event.event === "estimate");
}

describe("scanner history", () => {
  it("no_history_reports_null_once_after_start", () => {
    const root = treeOf(3);
    const { status, events } = scanRoot(root);
    const kinds = events.map((event) => event.event);

    expect(status).toBe(0);
    expect(kinds.slice(0, 2)).toEqual(["start", "estimate"]);
    expect(estimates(events)).toEqual([
      { event: "estimate", remaining_ms: null },
    ]);
    expect(new Set(kinds.slice(2))).toEqual(new Set(["progress"]));
  });

  it("history_reports_the_scaled_estimate", () => {
    const root = treeOf(100);
    seed(root, SEED);

    const first = estimates(scanRoot(root).events)[0]?.remaining_ms as number;

    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThanOrEqual(2000);

    for (const [now, wanted] of [
      [500, 1500],
      [2000, 0],
      [2001, null],
    ] as const) {
      seed(root, SEED);

      const { clock, lines, read } = clocked();
      const progress = progressTo((text) => lines.push(text), root, read);

      clock.now = now;
      progress.start(100);

      expect(estimates(eventsOf(lines))).toEqual([
        { event: "estimate", remaining_ms: wanted },
      ]);
    }
  });

  it("estimate_is_not_repeated_unchanged_and_moves_by_a_second", () => {
    const root = makeTempDir("recognizer-ts-history-");

    seed(root, SEED);

    const { clock, lines, read } = clocked();
    const progress = progressTo((text) => lines.push(text), root, read);

    progress.start(1000);

    expect(estimates(eventsOf(lines))).toEqual([
      { event: "estimate", remaining_ms: 20000 },
    ]);

    const after = (now: number): Event[] => {
      lines.length = 0;
      clock.now = now;

      for (let step = 0; step < 10; step += 1) {
        progress.advance();
      }

      return estimates(eventsOf(lines));
    };

    expect(after(0)).toEqual([]);
    expect(after(999)).toEqual([]);
    expect(after(1000)).toEqual([{ event: "estimate", remaining_ms: 19000 }]);
    expect(after(1000)).toEqual([]);
    expect(after(25000)).toEqual([{ event: "estimate", remaining_ms: null }]);
  });

  it("a_completed_run_is_recorded_and_a_failed_one_is_not", () => {
    const root = treeOf(3);

    expect(scanRoot(root).status).toBe(0);
    expect(stored(root)).toHaveLength(1);
    expect(stored(root)[0]).toMatchObject({ key: "run", units: 3 });

    const before = readFileSync(historyPath(root), "utf8");
    const missing = join(root, "nowhere");

    expect(
      run(["run", missing], { stdout() {}, stderr() {}, writeFile() {} }),
    ).toBe(2);
    expect(readFileSync(historyPath(root), "utf8")).toBe(before);

    const empty = makeTempDir("recognizer-ts-history-");
    const progress = progressTo(() => {}, empty);

    progress.start(0);
    progress.finish();
    progress.complete();

    expect(existsSync(historyPath(empty))).toBe(false);
  });

  it("history_keeps_the_last_five_runs", () => {
    const root = makeTempDir("recognizer-ts-history-");

    for (let units = 1; units <= 6; units += 1) {
      const progress = progressTo(() => {}, root);

      progress.start(units);
      progress.complete();
    }

    expect(stored(root).map((one) => one.units)).toEqual([2, 3, 4, 5, 6]);
  });

  it.each([
    ["invalid JSON", '{"runs": '],
    ["a runs that is not a list", '{"runs": 3}'],
  ])(
    "an_unreadable_history_reads_as_none_and_is_left_alone with %s",
    (_, content) => {
      const root = treeOf(3);
      const path = seed(root, content);
      const { events } = scanRoot(root);

      expect(estimates(events)).toEqual([
        { event: "estimate", remaining_ms: null },
      ]);
      expect(readFileSync(path, "utf8")).toBe(content);
    },
  );

  it("an_entry_with_a_boolean_is_skipped_while_a_valid_sibling_counts", () => {
    const root = makeTempDir("recognizer-ts-history-");

    seed(root, [{ key: "run", ms: true, units: 10 }, ...SEED]);

    const { clock, lines, read } = clocked();
    const progress = progressTo((text) => lines.push(text), root, read);

    clock.now = 500;
    progress.start(100);

    expect(estimates(eventsOf(lines))).toEqual([
      { event: "estimate", remaining_ms: 1500 },
    ]);
  });

  it("a_write_that_fails_does_not_fail_the_scan", () => {
    const root = treeOf(3);

    mkdirSync(join(root, ".recognizer"));
    writeFileSync(join(root, ".recognizer", "cache"), "in the way");

    const { status, out } = scanRoot(root);

    expect(status).toBe(0);
    expect(JSON.parse(out).modules.length).toBeGreaterThan(0);
  });

  it("the_cache_folder_ignores_itself", () => {
    const root = treeOf(2);

    scanRoot(root);

    const ignore = join(root, ".recognizer", "cache", ".gitignore");

    expect(readFileSync(ignore, "utf8").trim()).toBe("*");

    writeFileSync(ignore, "kept\n");
    scanRoot(root);

    expect(readFileSync(ignore, "utf8")).toBe("kept\n");
  });

  it("history_clock_is_the_awake_clock_and_reads_no_wall_clock", () => {
    const source = readFileSync(join(PACKAGE, "src", "history.ts"), "utf8");

    expect(source).toContain("process.hrtime.bigint()");

    for (const banned of [
      "Date.now",
      "new Date",
      "performance.timeOrigin",
      "SystemTime",
    ]) {
      expect(source).not.toContain(banned);
    }
  });

  it("a_wall_clock_jump_does_not_change_a_recorded_run_or_the_estimate", () => {
    const root = makeTempDir("recognizer-ts-history-");

    seed(root, SEED);

    const { clock, lines, read } = clocked();
    const progress = progressTo((text) => lines.push(text), root, read);

    clock.now = 500;
    progress.start(100);

    expect(estimates(eventsOf(lines))).toEqual([
      { event: "estimate", remaining_ms: 1500 },
    ]);

    clock.now = 1000;
    progress.complete();

    expect(stored(root).at(-1)).toEqual({ key: "run", ms: 1000, units: 100 });
  });

  it("a_run_over_the_committed_fixture_reports_a_null_estimate_then_records", () => {
    const root = makeTempDir("recognizer-ts-history-");

    cpSync(join(FIXTURE, "sample"), root, {
      recursive: true,
      filter: (path) => !path.includes(".recognizer"),
    });

    const { status, events } = scanRoot(root);
    const total = events[0]?.total;

    expect(status).toBe(0);
    expect(estimates(events)).toEqual([
      { event: "estimate", remaining_ms: null },
    ]);
    expect(stored(root).map((one) => one.units)).toEqual([total]);
  });
});
