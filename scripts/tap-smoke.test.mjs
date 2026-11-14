import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  fencedBlock,
  INSTALL_COMMANDS,
  missingPluginCommands,
  UNINSTALL_COMMANDS,
} from "./tap-smoke.mjs";
import { allFormulae, loadUnits } from "./units.mjs";

const README = readFileSync(
  fileURLToPath(new URL("../README.md", import.meta.url)),
  "utf8",
);

const names = [
  "recognizer-plugins",
  ...allFormulae(loadUnits(fileURLToPath(new URL("..", import.meta.url)))).map(
    (one) => one.formula,
  ),
].join(" ");

describe("the commands tap-smoke runs", () => {
  it("equal the first sh block of the README's Install section", () => {
    expect(fencedBlock(README, "Install")).toEqual(INSTALL_COMMANDS);
  });

  it("equal the first sh block of the README's Uninstall section", () => {
    expect(fencedBlock(README, "Uninstall")).toEqual(UNINSTALL_COMMANDS);
    expect(UNINSTALL_COMMANDS).toEqual([
      "recognizer agents uninstall",
      "brew uninstall --cask kenmclennan/tap/recognizer",
      `brew uninstall ${names}`,
      "brew autoremove",
    ]);
  });

  it("names every formula and the bundle in the README's Uninstall line", () => {
    const line = fencedBlock(README, "Uninstall").find((command) =>
      command.startsWith("brew uninstall recognizer-"),
    );

    expect(line.split(" ").slice(2).sort()).toEqual(
      [...names.split(" ")].sort(),
    );
  });

  it("fails when a section or its block is absent", () => {
    expect(() => fencedBlock("# x\n\n## Install\n\ntext\n", "Install")).toThrow(
      /no sh block/,
    );
    expect(() => fencedBlock("# x\n", "Uninstall")).toThrow(
      /no Uninstall section/,
    );
  });
});

describe("missingPluginCommands", () => {
  const listing = JSON.stringify([
    {
      kind: "scanner",
      name: "python",
      command: "/opt/bin/recognizer-scan-python",
    },
    { kind: "sensor", name: "crap", command: "/opt/bin/recognizer-sense-crap" },
  ]);

  it("names nothing when every command is a listed plugin's command", () => {
    expect(
      missingPluginCommands(listing, [
        "recognizer-scan-python",
        "recognizer-sense-crap",
      ]),
    ).toEqual([]);
  });

  it("names a command no plugin has, not one that only shares a prefix", () => {
    expect(
      missingPluginCommands(listing, [
        "recognizer-scan",
        "recognizer-sense-crap",
        "recognizer-scan-rust",
      ]),
    ).toEqual(["recognizer-scan", "recognizer-scan-rust"]);
  });
});
