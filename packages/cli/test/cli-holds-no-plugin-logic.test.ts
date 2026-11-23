import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO } from "./helpers.js";

const SRC = join(REPO, "packages/cli/src");
const CORE_SRC = join(REPO, "packages/core/src");
const REMOVED = [
  "plugin-add.ts",
  "plugin-discovery.ts",
  "plugin-doctor.ts",
  "plugin-events.ts",
  "plugin-init.ts",
  "plugin-manifest.ts",
  "plugin-sentence.ts",
  "plugin-templates.ts",
  "shipped-sensors.ts",
  "shipped-describer.ts",
  "unregistered-plugins.ts",
];
const COMMANDS = [
  "doctor-command.ts",
  "plugin-command.ts",
  "plugins-command.ts",
];
const SHIPPED_NAME =
  /SHIPPED_DESCRIBER_(NAME|COMMAND)|SHIPPED_SENSORS|"(crap|mutation)"|REFERENCE_PROGRAM/;

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    return entry.isDirectory()
      ? entry.name === "generated"
        ? []
        : filesUnder(path)
      : path.endsWith(".ts")
        ? [path]
        : [];
  });
}

function namesShippedPlugin(text: string): boolean {
  return SHIPPED_NAME.test(text);
}

function importsRemoved(text: string): boolean {
  return REMOVED.some((file) =>
    text.includes(`./${file.replace(/\.ts$/, ".js")}`),
  );
}

function exportedNames(text: string): string[] {
  return [
    ...text.matchAll(
      /^export (?:async )?(?:function|const|class|interface|type) (\w+)/gm,
    ),
  ].map((match) => match[1] as string);
}

describe("the CLI holds no plugin logic", () => {
  it("names no shipped plugin in code", () => {
    const files = [...filesUnder(SRC), ...filesUnder(CORE_SRC)];

    expect(files.length).toBeGreaterThan(0);
    expect(
      files.filter((file) => namesShippedPlugin(readFileSync(file, "utf8"))),
    ).toEqual([]);
  });

  it("has none of the moved modules", () => {
    expect(REMOVED.length).toBeGreaterThan(0);
    expect(REMOVED.filter((file) => existsSync(join(SRC, file)))).toEqual([]);
    expect(
      exportedNames(readFileSync(join(SRC, "plugin-check.ts"), "utf8")).sort(),
    ).toEqual(["reportFailed", "reportLines"]);
    expect(
      exportedNames(readFileSync(join(SRC, "doctor.ts"), "utf8")).sort(),
    ).toEqual(["reportJson", "reportText"]);
  });

  it("keeps the command files free of the moved modules", () => {
    expect(COMMANDS.length).toBeGreaterThan(0);

    for (const file of COMMANDS) {
      expect(importsRemoved(readFileSync(join(SRC, file), "utf8")), file).toBe(
        false,
      );
    }
  });

  it("the matchers flag a known offending string and pass a clean one", () => {
    expect(namesShippedPlugin('const x = "crap";')).toBe(true);
    expect(namesShippedPlugin("export const SHIPPED_SENSORS = [];")).toBe(true);
    expect(namesShippedPlugin("const x = names();")).toBe(false);
    expect(importsRemoved('import { x } from "./plugin-add.js";')).toBe(true);
    expect(importsRemoved('import { x } from "./plugin-command.js";')).toBe(
      false,
    );
  });
});
