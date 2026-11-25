import {
  createEventReader as createReader,
  EVENT_PREFIX,
  type PluginEvent,
  parseEventLine as parseLine,
} from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { documentValidators } from "../src/manifest-ports.js";

const valid = (value: unknown) => documentValidators.event(value);
const createEventReader = (
  onEvent?: (event: PluginEvent) => void,
  now?: () => number,
) => createReader(valid, onEvent, now);
const parseEventLine = (text: string) => parseLine(text, valid);

const line = (value: unknown) => `${EVENT_PREFIX}${JSON.stringify(value)}`;

const VALID: PluginEvent[] = [
  { event: "start", total: 4, unit: "files" },
  { event: "progress", done: 1, total: 4, unit: "files", step: "Reading" },
  { event: "note", text: "Coverage run: unit" },
  {
    event: "diagnosis",
    code: "no-coverage",
    text: "no report",
    fix: "add one",
  },
  { event: "diagnosis", code: "tests-failed", text: "3 tests failed" },
  { event: "stage", name: "Coverage run", index: 1, of: 2 },
  { event: "estimate", remaining_ms: 1000 },
];

describe("the plugin event reader", () => {
  it.each(VALID)("forwards a valid $event event", (event) => {
    const seen: PluginEvent[] = [];
    const reader = createEventReader((one) => seen.push(one));

    reader.line(line(event));

    expect(seen).toEqual([event]);
    expect(reader.keep(`${line(event)}\n`)).toBe("");
  });

  it("accepts a diagnosis with no fix", () => {
    expect(
      parseEventLine(line({ event: "diagnosis", code: "x", text: "y" })),
    ).toEqual({
      kind: "event",
      event: { event: "diagnosis", code: "x", text: "y" },
    });
  });

  it.each([
    ["an invalid JSON line", `${EVENT_PREFIX}{not json`],
    ["a line that fails the schema", line({ event: "progress", done: 1 })],
    [
      "a line with an unknown key",
      line({ event: "note", text: "x", extra: true }),
    ],
  ])("drops %s and counts it", (_name, text) => {
    const seen: PluginEvent[] = [];
    const reader = createEventReader((one) => seen.push(one));

    reader.line(text);

    expect(seen).toEqual([]);
    expect(reader.keep("")).toBe("ignored 1 invalid event line\n");
  });

  it.each([
    ["a line without the prefix", JSON.stringify(VALID[0])],
    ["a prefix in the middle of a line", `x ${line(VALID[0])}`],
  ])("passes %s through as plain text", (_name, text) => {
    const seen: PluginEvent[] = [];
    const reader = createEventReader((one) => seen.push(one));

    reader.line(text);

    expect(seen).toEqual([]);
    expect(reader.keep(`${text}\n`)).toBe(`${text}\n`);
  });

  it("reports the invalid count as one stderr line after the plain text", () => {
    const reader = createEventReader();

    reader.line(`${EVENT_PREFIX}{bad`);
    reader.line(line({ event: "later" }));

    expect(reader.keep("plain\n")).toBe(
      "plain\nignored 2 invalid event lines\n",
    );
  });

  it("remembers the last diagnosis and the time of the first progress above 0", () => {
    let clock = 0;
    const reader = createEventReader(undefined, () => {
      clock += 10;

      return clock;
    });

    reader.line(line({ event: "progress", done: 0, total: 2, unit: "f" }));
    reader.line(line({ event: "progress", done: 1, total: 2, unit: "f" }));
    reader.line(line({ event: "progress", done: 2, total: 2, unit: "f" }));
    reader.line(line({ event: "diagnosis", code: "a", text: "first" }));
    reader.line(
      line({ event: "diagnosis", code: "b", text: "last", fix: "do it" }),
    );

    expect(reader.firstWorked()).toBe(10);
    expect(reader.diagnosis()).toEqual({
      code: "b",
      line: "last",
      fix: "do it",
    });
  });

  it("reports each stage's own duration from its stage event to the next, the last lasting until suites() is read", () => {
    let clock = 0;
    const times = [100, 400, 1000];
    const reader = createEventReader(undefined, () => times[clock++] as number);
    const stage = (index: number, name: string) =>
      line({ event: "stage", name, index, of: 2 });

    reader.line(stage(1, "engine"));
    reader.line(stage(2, "app"));

    expect(reader.suites()).toEqual([
      { name: "engine", duration_ms: 300 },
      { name: "app", duration_ms: 600 },
    ]);
  });

  it("reports no suites for a run with no stage event", () => {
    const reader = createEventReader();

    reader.line(
      line({ event: "progress", done: 1, total: 2, unit: "f", step: "x" }),
    );

    expect(reader.suites()).toEqual([]);
  });

  it("reads_a_stage_and_an_estimate_event", () => {
    const seen: PluginEvent[] = [];
    const reader = createEventReader((one) => seen.push(one));

    reader.line(line({ event: "stage", name: "one", index: 1, of: 3 }));
    reader.line(line({ event: "estimate", remaining_ms: 5000 }));
    reader.line(line({ event: "estimate", remaining_ms: null }));

    expect(seen).toEqual([
      { event: "stage", name: "one", index: 1, of: 3 },
      { event: "estimate", remaining_ms: 5000 },
      { event: "estimate", remaining_ms: null },
    ]);
  });

  it("drops_a_stage_whose_index_passes_its_total", () => {
    const seen: PluginEvent[] = [];
    const reader = createEventReader((one) => seen.push(one));
    const bad = line({ event: "stage", name: "one", index: 4, of: 3 });

    reader.line(bad);

    expect(seen).toEqual([]);
    expect(reader.keep(`${bad}\n`)).toBe("ignored 1 invalid event line\n");
  });
});
