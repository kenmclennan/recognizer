import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { COMMANDS } from "../src/commands.js";
import { shortHelp } from "../src/help.js";
import { pluginCheck } from "../src/plugin-check.js";
import { pluginGuide } from "../src/plugin-guide.js";
import { CURRENT_PROTOCOL } from "../src/plugin-manifest.js";
import { capture, REPO } from "./helpers.js";

const MANIFEST = JSON.parse(
  readFileSync(join(REPO, "schema/manifest.schema.json"), "utf8"),
) as {
  properties: Record<string, unknown>;
  $defs: { setting: { properties: Record<string, unknown> } };
};

function nonEmpty<T>(values: T[]): T[] {
  expect(values.length).toBeGreaterThan(0);

  return values;
}

describe("recognizer help plugin-guide", () => {
  it("prints the guide and exits 0", () => {
    const captured = capture();

    expect(run(["help", "plugin-guide"], captured.io)).toBe(0);
    expect(captured.out()).toBe(pluginGuide());
  });

  it("is a usage error with an argument", () => {
    const captured = capture();

    expect(run(["help", "plugin-guide", "extra"], captured.io)).toBe(2);
    expect(captured.out()).toBe("");
  });

  it("is not a command, and shortHelp names it", () => {
    expect(COMMANDS.map((command) => command.name)).not.toContain(
      "plugin-guide",
    );
    expect(shortHelp()).toContain(
      "run `recognizer help plugin-guide` for the guide a plugin author follows",
    );
  });

  it("holds every manifest and setting property", () => {
    const guide = pluginGuide();
    const names = nonEmpty([
      ...Object.keys(MANIFEST.properties),
      ...Object.keys(MANIFEST.$defs.setting.properties),
    ]);

    for (const name of names) {
      expect(guide).toContain(name);
    }
  });

  it("holds the events, the verbs, the schema names and the protocol", () => {
    const guide = pluginGuide();

    for (const word of nonEmpty([
      "start",
      "progress",
      "note",
      "diagnosis",
      "manifest",
      "check",
      "run",
      "guide",
      "manifest",
      "events",
      "scan",
      "findings",
      "overlay",
    ])) {
      expect(guide).toContain(word);
    }

    expect(guide).toContain(`The current one is ${CURRENT_PROTOCOL}.`);
  });

  it("names every result a real plugin check returns", async () => {
    const report = await pluginCheck(
      capture().io,
      join(REPO, "fixtures/plugins/conforming/recognizer-scan-conforming"),
    );
    const names = nonEmpty(report.results.map((entry) => entry.name));
    const guide = pluginGuide();

    expect(names).toHaveLength(13);

    for (const name of names) {
      expect(guide).toContain(name);
    }
  });

  it("never says help plugins", () => {
    expect(pluginGuide()).not.toContain("help plugins");
  });
});
