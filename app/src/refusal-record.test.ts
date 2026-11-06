import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { refusalsOf } from "./refusal-record";

const T0 = Date.parse("2026-11-02T09:00:00.000Z");
const DIAGNOSIS = {
  code: "tests-failed",
  line: "3 tests failed.",
  failing: { names: ["t::a"], count: 3 },
};

type Entry = {
  name: string;
  outcome: "ok" | "failed";
  reason?: string;
  diagnosis?: unknown;
};

function entry(e: Entry) {
  return {
    command: ["x"],
    status: e.outcome === "ok" ? 0 : 1,
    duration_ms: 1,
    stderr: "",
    ...e,
  };
}

function scan(
  entries: Entry[],
  over: Record<string, unknown> = {},
  phase = "sense",
) {
  return JSON.stringify({
    log_version: 1,
    kind: "scan",
    started: "2026-11-02T09:00:00.000Z",
    finished: "2026-11-02T09:00:05.000Z",
    by: "ken",
    arguments: [],
    outcome: "ok",
    exit: 0,
    phases: [{ phase, entries: entries.map(entry) }],
    ...over,
  });
}

const FINISHED = Date.parse("2026-11-02T09:00:05.000Z");
const failed = (name: string, extra: Partial<Entry> = {}): Entry => ({
  name,
  outcome: "failed",
  reason: "tests failed",
  diagnosis: DIAGNOSIS,
  ...extra,
});
const file = (name: string, text: string) => ({ name, text });

describe("refusalsOf", () => {
  it("reads a failed entry newer than the document as a refusal with its reason and diagnosis", () => {
    const found = refusalsOf(
      [file("20261102T090000000Z-scan.json", scan([failed("crap")]))],
      ["crap"],
      [{ name: "crap", modifiedMs: T0 }],
    );

    expect(found).toEqual({
      crap: { reason: "tests failed", diagnosis: DIAGNOSIS, at: FINISHED },
    });
  });

  it("treats a document as new as the record as newer, and one millisecond older as not", () => {
    const files = [
      file("20261102T090000000Z-scan.json", scan([failed("crap")])),
    ];

    expect(
      refusalsOf(files, ["crap"], [{ name: "crap", modifiedMs: FINISHED }]),
    ).toEqual({});
    expect(
      Object.keys(
        refusalsOf(
          files,
          ["crap"],
          [{ name: "crap", modifiedMs: FINISHED - 1 }],
        ),
      ),
    ).toEqual(["crap"]);
  });

  it("reads a failed entry with no document as a refusal", () => {
    const files = [
      file("20261102T090000000Z-scan.json", scan([failed("crap")])),
    ];

    expect(Object.keys(refusalsOf(files, ["crap"], []))).toEqual(["crap"]);
    expect(
      Object.keys(
        refusalsOf(files, ["crap"], [{ name: "crap", modifiedMs: null }]),
      ),
    ).toEqual(["crap"]);
  });

  it("gives none when the newest entry is ok even though an older record failed", () => {
    const files = [
      file("20261102T090000000Z-scan.json", scan([failed("crap")])),
      file(
        "20261102T100000000Z-scan.json",
        scan([{ name: "crap", outcome: "ok" }]),
      ),
    ];

    expect(refusalsOf(files, ["crap"], [])).toEqual({});
  });

  it("falls through a newest record that lacks the sensor to an older one that has it", () => {
    const files = [
      file("20261102T090000000Z-scan.json", scan([failed("crap")])),
      file(
        "20261102T100000000Z-scan.json",
        scan([{ name: "mutation", outcome: "ok" }]),
      ),
    ];

    expect(Object.keys(refusalsOf(files, ["crap"], []))).toEqual(["crap"]);
  });

  it("ignores a describe record and a non-sense phase entry with a sensor's name", () => {
    const files = [
      file(
        "20261102T100000000Z-scan.json",
        scan([failed("crap")], {}, "measure"),
      ),
      file(
        "20261102T090000000Z-scan.json",
        JSON.stringify({
          log_version: 1,
          kind: "describe",
          started: "2026-11-02T09:00:00.000Z",
          finished: "2026-11-02T09:00:05.000Z",
          by: "ken",
          arguments: [],
          outcome: "failed",
          exit: 1,
          entries: [entry(failed("crap"))],
        }),
      ),
    ];

    expect(refusalsOf(files, ["crap"], [])).toEqual({});
  });

  it("reads the entries of a sense record", () => {
    const record = JSON.stringify({
      log_version: 1,
      kind: "sense",
      started: "2026-11-02T09:00:00.000Z",
      finished: "2026-11-02T09:00:05.000Z",
      by: "ken",
      arguments: [],
      outcome: "failed",
      exit: 1,
      entries: [entry(failed("crap"))],
    });

    expect(
      Object.keys(
        refusalsOf(
          [file("20261102T090000000Z-sense.json", record)],
          ["crap"],
          [],
        ),
      ),
    ).toEqual(["crap"]);
  });

  it("skips an invalid or unparsable newest record and uses the next", () => {
    const files = [
      file("20261102T120000000Z-scan.json", "not json"),
      file("20261102T110000000Z-scan.json", JSON.stringify({ kind: "scan" })),
      file("20261102T090000000Z-scan.json", scan([failed("crap")])),
    ];

    expect(Object.keys(refusalsOf(files, ["crap"], []))).toEqual(["crap"]);
  });

  it("skips a record whose entry carries a malformed diagnosis, since the schema rejects it", () => {
    const files = [
      file(
        "20261102T090000000Z-scan.json",
        scan([failed("crap", { diagnosis: { code: "nope" } })]),
      ),
    ];

    expect(refusalsOf(files, ["crap"], [])).toEqual({});
  });

  it("uses started for a running record and a fixed reason when the entry has none", () => {
    const files = [
      file(
        "20261102T090000000Z-scan.json",
        scan([{ name: "crap", outcome: "failed" }], {
          finished: null,
          outcome: "running",
        }),
      ),
    ];

    expect(refusalsOf(files, ["crap"], [])).toEqual({
      crap: { reason: "failed", at: T0 },
    });
  });

  it("gives exactly one refusal for three registered sensors", () => {
    const files = [
      file(
        "20261102T090000000Z-scan.json",
        scan([failed("crap"), { name: "duplication", outcome: "ok" }]),
      ),
    ];

    expect(
      Object.keys(refusalsOf(files, ["crap", "duplication", "mutation"], [])),
    ).toEqual(["crap"]);
  });

  it("reads the committed run record examples with a failed sense entry", () => {
    const directory = join(__dirname, "../../schema/log-examples/valid");
    const files = readdirSync(directory)
      .filter((name) => name.endsWith(".json"))
      .map((name) => file(name, readFileSync(join(directory, name), "utf8")));
    const found = files.flatMap((one) =>
      Object.keys(refusalsOf([one], ["coverage-gaps", "crap", "mutation"], [])),
    );

    expect(found).toEqual(["mutation"]);
  });
});
