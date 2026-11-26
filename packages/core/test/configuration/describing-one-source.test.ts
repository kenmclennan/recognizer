import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { machineSetting } from "../../src/index.js";

const ROOT = join(import.meta.dirname, "../../../..");
const WALKED = [
  "packages/core/src",
  "packages/cli/src",
  "packages/app/src",
  "packages/app/src-tauri/src",
];
const CORE_SETTINGS = "packages/core/src/domain/configuration/core-settings.ts";

interface Line {
  file: string;
  number: number;
  text: string;
}

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(directory, entry.name))
      : [join(directory, entry.name)],
  );
}

const LINES: Line[] = WALKED.flatMap((directory) =>
  files(join(ROOT, directory)).flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .map((text, index) => ({
        file: relative(ROOT, file),
        number: index + 1,
        text,
      })),
  ),
);

function hits(match: (line: Line) => boolean): string[] {
  return LINES.filter(match).map((line) => `${line.file}:${line.number}`);
}

function standalone(text: string, number: number): boolean {
  return new RegExp(`(?<![0-9._])${number}(?![0-9._])`).test(text);
}

describe("describing settings have one source", () => {
  it("names no model the describer owns", () => {
    expect(hits((line) => /haiku/i.test(line.text))).toEqual([]);
  });

  it("holds none of the removed default and bound identifiers", () => {
    const removed =
      /MAX_BATCH_SIZE|MAX_CONFIRM_ABOVE_USD|DEFAULT_CONFIRM_ABOVE_USD|DEFAULT_BATCH_SIZE|DEFAULT_MODEL|DEFAULT_SETUP_MODEL|DESCRIBING_DEFAULTS|PRICES_PER_MILLION/;

    expect(hits((line) => removed.test(line.text))).toEqual([]);
  });

  it.each([
    ["describing.batch_size", /batch_size|batchSize/],
    ["describing.confirm_above_usd", /confirm_above_usd|confirmAboveUsd/],
  ])(
    "defines the default and range of %s once, in core's machine settings",
    (key, token) => {
      const entry = machineSetting(key);
      const numbers = [entry.default, entry.maximum].filter(
        (value): value is number => typeof value === "number",
      );

      expect(numbers.length).toBeGreaterThan(0);
      expect(
        hits(
          (line) =>
            line.file !== CORE_SETTINGS &&
            token.test(line.text) &&
            numbers.some((number) => standalone(line.text, number)),
        ),
      ).toEqual([]);
    },
  );

  it("keeps the shared defaults fixture gone", () => {
    expect(
      existsSync(join(ROOT, "fixtures/settings/describing-defaults.json")),
    ).toBe(false);
  });
});
