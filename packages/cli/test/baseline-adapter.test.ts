import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BaselineAdapter,
  parseBaseline,
} from "../src/adapters/filesystem/baseline-adapter.js";
import { fakeIo, ROOT } from "./scan-helpers.js";

const PATH = `${ROOT}/.recognizer/baselines/violations.json`;
const VALID = `${JSON.stringify({
  schema_version: 1,
  violations: [
    { from: "a.py", to: "b.py", kind: "depends" },
    { from: "c.py", to: "d.py", kind: "depends" },
  ],
})}\n`;

describe("the baseline adapter", () => {
  it("reads_writes_and_reports_the_baseline_file", () => {
    const { io } = fakeIo({ files: { [PATH]: VALID } });
    const baselines = new BaselineAdapter(io);

    expect(baselines.exists(PATH)).toBe(true);
    expect(baselines.exists(`${ROOT}/missing.json`)).toBe(false);

    const entries = baselines.read(PATH);

    expect(entries).toHaveLength(2);

    baselines.write(PATH, entries.slice(1));

    expect(baselines.read(PATH)).toEqual(entries.slice(1));
  });

  it("an invalid or unreadable baseline throws the message the check command shows", () => {
    const { io } = fakeIo({ files: { [PATH]: "{" } });
    const baselines = new BaselineAdapter(io);

    expect(() => baselines.read(PATH)).toThrow(/^baseline is not valid JSON: /);
    expect(() => baselines.read(`${ROOT}/missing.json`)).toThrow(
      `cannot read baseline file: ${ROOT}/missing.json`,
    );
  });

  it("reads the committed check baseline as parseBaseline does", () => {
    const text = readFileSync(
      new URL(
        "../../../fixtures/check/.recognizer/baselines/violations.json",
        import.meta.url,
      ),
      "utf8",
    );
    const { io } = fakeIo({ files: { [PATH]: text } });
    const entries = new BaselineAdapter(io).read(PATH);

    expect(entries.length).toBeGreaterThan(0);
    expect(entries).toEqual(parseBaseline(text));
  });
});
