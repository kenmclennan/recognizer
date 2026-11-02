import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config-parse.js";
import { REPO } from "./helpers.js";

function settingsOf(yaml: string): string {
  const entry = parseConfig(yaml).sensors?.["unused-exports"] as {
    command: string[];
  };

  expect(entry.command.slice(0, 2)).toEqual([
    "recognizer-sensors",
    "unused-exports",
  ]);

  return entry.command.at(-1) as string;
}

describe("unused-exports short form", () => {
  it("expands the valid example to the shipped command", () => {
    const text = readFileSync(
      join(
        REPO,
        "schema/config-examples/valid/sensors-unused-exports-short.yaml",
      ),
      "utf8",
    );

    expect(settingsOf(text)).toBe("{}");
  });

  it("copies the orphan entry points when none are given", () => {
    expect(
      settingsOf(`sensors:
  structure:
    warnings:
      orphan:
        entry_points: ["src/main/**"]
  unused-exports: {}
`),
    ).toBe('{"entry_points":["src/main/**"]}');
  });

  it("keeps an explicit entry_points, including an empty one", () => {
    expect(
      settingsOf(`sensors:
  structure:
    warnings:
      orphan:
        entry_points: ["src/main/**"]
  unused-exports:
    entry_points: []
`),
    ).toBe('{"entry_points":[]}');
  });

  it.each([
    [
      "orphan is a boolean",
      "  structure:\n    warnings:\n      orphan: true\n",
    ],
    ["structure is absent", ""],
    ["structure is off", "  structure: off\n"],
  ])("injects nothing when %s", (_name, structure) => {
    expect(settingsOf(`sensors:\n${structure}  unused-exports: {}\n`)).toBe(
      "{}",
    );
  });
});
