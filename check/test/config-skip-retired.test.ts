import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config-parse.js";
import { RETIRED_KEYS } from "../src/config-retired.js";
import type { InputError } from "../src/errors.js";
import { REPO } from "./helpers.js";

const SKIP = { skipRetired: true };

function documentWith(path: string[]): string {
  return path.length === 1
    ? "overlays:\n  crap:\n    command: [x]\n"
    : `sensors:\n  structure:\n${
        path.length === 4
          ? `    warnings:\n      ${path[3]}: true\n`
          : `    ${path[2]}: 1\n`
      }`;
}

function messageOf(text: string, options?: { skipRetired?: boolean }): string {
  try {
    parseConfig(text, "all", options);
  } catch (error) {
    return (error as InputError).messages.join("\n");
  }

  return "";
}

describe("parseConfig with skipRetired", () => {
  it.each(RETIRED_KEYS.map((retired) => [retired.path.join(".")]))(
    "skips %s and equals the config without it",
    (key) => {
      const path = key.split(".");
      const text = documentWith(path);

      expect(parseConfig(text, "all", SKIP)).toEqual(parseConfig("", "all"));
      expect(messageOf(text)).not.toBe("");
    },
  );

  it("equals the config with the retired keys deleted by hand when several are held", () => {
    const text = [
      "overlays:",
      "  crap:",
      "    command: [x]",
      "sensors:",
      "  structure:",
      "    distance_threshold: 0.5",
      "    composition_roots: [a]",
      "    warnings:",
      "      hub: true",
      "      folder_cycle: false",
      "  crap:",
      "    command: [crap-cmd]",
      "",
    ].join("\n");
    const by_hand = "sensors:\n  crap:\n    command: [crap-cmd]\n";

    expect(parseConfig(text, "all", SKIP)).toEqual(parseConfig(by_hand));
  });

  it("drops the sections the skip empties", () => {
    const text =
      "sensors:\n  structure:\n    composition_roots: [a]\n    warnings:\n      hub: true\n";

    expect(parseConfig(text, "all", SKIP)).toEqual(parseConfig(""));
  });

  it("keeps a section that still holds a setting", () => {
    const text =
      "sensors:\n  structure:\n    composition_roots: [a]\n    warnings:\n      hub: true\n      cycle: false\n";
    const by_hand =
      "sensors:\n  structure:\n    warnings:\n      cycle: false\n";

    expect(parseConfig(text, "all", SKIP)).toEqual(parseConfig(by_hand));
  });

  it.each([
    [
      "bad YAML",
      "overlays: [\nsensors:\n  structure:\n    hub_threshold: 1\n",
      "config is not valid YAML",
    ],
    [
      "a schema fault",
      "sensors:\n  structure:\n    hub_threshold: 1\n    unknown_key: 1\n",
      "unknown_key",
    ],
    [
      "an unknown key under sensors.duplication",
      "sensors:\n  structure:\n    hub_threshold: 1\n  duplication:\n    bogus: 1\n",
      "sensors/duplication unknown setting: bogus",
    ],
    [
      "a null section the user wrote",
      "sensors:\n  structure:\n    hub_threshold: 1\n  crap:\n",
      "crap",
    ],
  ])("still refuses %s", (_name, text, expected) => {
    const message = messageOf(text, SKIP);

    expect(message).toContain(expected);
    expect(message).not.toContain("hub_threshold");
  });

  it("moves the four sensors.duplication settings to sensors.structure.duplication", () => {
    const text =
      "sensors:\n  duplication:\n    threshold: 0.5\n    min_lines: 4\n    pair_min_lines: 6\n    min_nodes: 20\n";
    const by_hand =
      "sensors:\n  structure:\n    duplication:\n      threshold: 0.5\n      min_lines: 4\n      pair_min_lines: 6\n      min_nodes: 20\n";

    expect(parseConfig(text, "all", SKIP)).toEqual(parseConfig(by_hand));
  });

  it("moves sensors.duplication beside the other structure settings", () => {
    const text =
      "sensors:\n  structure:\n    warnings:\n      cycle: true\n  duplication:\n    min_lines: 4\n";
    const by_hand =
      "sensors:\n  structure:\n    warnings:\n      cycle: true\n    duplication:\n      min_lines: 4\n";

    expect(parseConfig(text, "all", SKIP)).toEqual(parseConfig(by_hand));
  });

  it("translates an empty or null sensors.duplication to nothing", () => {
    expect(parseConfig("sensors:\n  duplication: {}\n", "all", SKIP)).toEqual(
      parseConfig(""),
    );
    expect(parseConfig("sensors:\n  duplication:\n", "all", SKIP)).toEqual(
      parseConfig(""),
    );
  });

  it("keeps sensors.structure.duplication when both are present", () => {
    const text =
      "sensors:\n  structure:\n    duplication:\n      min_lines: 9\n  duplication:\n    min_lines: 4\n    threshold: 0.5\n";
    const by_hand =
      "sensors:\n  structure:\n    duplication:\n      min_lines: 9\n";

    expect(parseConfig(text, "all", SKIP)).toEqual(parseConfig(by_hand));
  });

  it("moves a switched-off sensors.duplication", () => {
    expect(
      parseConfig("sensors:\n  duplication: false\n", "all", SKIP),
    ).toEqual(parseConfig("sensors:\n  structure:\n    duplication: false\n"));
  });

  it("still refuses sensors.duplication without the option", () => {
    expect(messageOf("sensors:\n  duplication: {}\n")).toContain(
      "sensors/duplication was removed",
    );
  });

  it("does not skip without the option", () => {
    expect(messageOf("overlays:\n  crap:\n    command: [x]\n")).toContain(
      "config/overlays is retired",
    );
  });

  it("parses every committed retired example", () => {
    const directory = join(REPO, "schema/config-examples/invalid");
    const names = readdirSync(directory).filter(
      (name) =>
        name.startsWith("sensors-retired-") || name === "overlays-retired.yaml",
    );

    expect(names).toHaveLength(9);

    for (const name of names) {
      expect(() =>
        parseConfig(readFileSync(join(directory, name), "utf8"), "all", SKIP),
      ).not.toThrow();
    }
  });
});
