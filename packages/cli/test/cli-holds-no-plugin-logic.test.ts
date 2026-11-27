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

function allFilesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    return entry.isDirectory()
      ? entry.name === "generated"
        ? []
        : allFilesUnder(path)
      : [path];
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

function importsLogic(text: string): boolean {
  return /from "(node:[^"]*|\.\/(cli|plugin-run|config|config-parse|manifest-ports)\.js)"/.test(
    text,
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

  it("the shipped category is gone", () => {
    const gone = [
      "packages/core/src/application/plugins/ports/shipped-plugins.ts",
      "packages/cli/src/adapters/plugins/shipped-plugins-adapter.ts",
      "packages/cli/scripts/build-shipped.mjs",
    ];
    const manifest = readFileSync(
      join(REPO, "packages/cli/package.json"),
      "utf8",
    );

    expect(gone.filter((file) => existsSync(join(REPO, file)))).toEqual([]);
    expect(manifest.includes("build-shipped")).toBe(false);
  });

  it("uses the word shipped only in the Kotlin entry annotation line", () => {
    const trees = [
      "packages/core/src",
      "packages/cli/src",
      "packages/cli/scripts",
      "packages/app/src",
      "packages/app/src-tauri/src",
      "packages/app/src-tauri/permissions",
    ].map((tree) => join(REPO, tree));
    const files = [
      ...trees.flatMap((tree) => allFilesUnder(tree)),
      join(REPO, "packages/app/src-tauri/build.rs"),
      join(REPO, "packages/cli/package.json"),
    ];
    const hits = files.flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => /shipped/i.test(line))
        .map((line) => `${file.slice(REPO.length + 1)}: ${line.trim()}`),
    );

    expect(files.length).toBeGreaterThan(0);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain(
      "packages/core/src/domain/configuration/published-keys.ts",
    );
    expect(hits[0]).toContain("beside the shipped container annotations");
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

  it("keeps sensors-check.ts to its rendering", () => {
    const text = readFileSync(join(SRC, "sensors-check.ts"), "utf8");

    expect(exportedNames(text).sort()).toEqual(["reportJson", "reportText"]);
    expect(importsLogic(text)).toBe(false);
    expect(importsLogic('import { run } from "./plugin-run.js";')).toBe(true);
    expect(importsLogic('import { basename } from "node:path";')).toBe(true);
    expect(importsLogic('import type { Io } from "./cli.js";')).toBe(true);
    expect(importsLogic('import type { X } from "@recognizer/core";')).toBe(
      false,
    );
    expect(
      readFileSync(join(SRC, "scan-phases.ts"), "utf8").includes(
        "function selectSensors",
      ),
    ).toBe(false);
  });

  it("keeps the sensors adapter to process and file access", () => {
    const forbidden =
      /\b(select|plan|registered|registeredSensors|readInstalledSensors|selectSensors|refuseUnregistered|isScoped|commitGaps|programGaps|readinessGaps|installFix)\b|\brunsTests\(/;
    const text = readFileSync(
      join(SRC, "adapters/plugins/sensors-adapter.ts"),
      "utf8",
    );

    expect(forbidden.test(text)).toBe(false);
    expect(forbidden.test("  select(input: X): Y {")).toBe(true);
    expect(forbidden.test("  registered(root: string) {")).toBe(true);
    expect(forbidden.test("  commitGaps(input: X): Gap[] {")).toBe(true);
  });

  it("keeps the repository checks adapter to fact gathering", () => {
    const forbidden =
      /\b(retiredKeysIn|withoutRetiredKeys|emptySections|withoutEmptySections|duplicateSuites|retiredSettings|unpublishedValues|manifestFix|kindOfProgram|policyProblems|SetupProblem)\b|code: "/;
    const text = readFileSync(
      join(SRC, "adapters/plugins/repository-checks-adapter.ts"),
      "utf8",
    );

    expect(forbidden.test(text)).toBe(false);
    expect(forbidden.test("const found = emptySections(document);")).toBe(true);
    expect(forbidden.test('  code: "config-yaml",')).toBe(true);
    expect(forbidden.test("return this.io.exists(file);")).toBe(false);
  });

  it("keeps the describer adapter and the preflight module free of gap decisions", () => {
    const forbidden =
      /\b(commitGaps|programGaps|readinessGaps|describerGaps|installFix|sensorProgramGaps)\b/;
    const text = readFileSync(
      join(SRC, "adapters/plugins/describer-adapter.ts"),
      "utf8",
    );

    expect(existsSync(join(SRC, "preflight.ts"))).toBe(false);
    expect(forbidden.test(text)).toBe(false);
    expect(forbidden.test("  describerGaps(input: X): Gap[] {")).toBe(true);
  });

  it("reads a command's run element only in core", () => {
    const text = readFileSync(join(SRC, "plugin-run.ts"), "utf8");

    expect(/indexOf\("run"\)/.test(text)).toBe(false);
    expect(text.includes("pluginPrefix")).toBe(false);
    expect(/splitAtRun/.test(text)).toBe(true);
  });

  it("keeps the policy translator to YAML parsing", () => {
    const text = readFileSync(
      join(SRC, "adapters/filesystem/policy-translator.ts"),
      "utf8",
    );

    expect(text.includes("parsePolicy")).toBe(true);

    for (const forbidden of [
      "ALLOWED_KEYS",
      "RETIRED",
      "unknown key",
      "must be a",
      "isPlainObject",
    ]) {
      expect(text.includes(forbidden)).toBe(false);
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

  it("keeps config-parse.ts free of retired-sensor rules", () => {
    const rules =
      /was removed|unknown setting|must be above 0|must be an integer of at least 1|DUPLICATION_KEYS/;
    const text = readFileSync(join(SRC, "config-parse.ts"), "utf8");

    expect(rules.test(text)).toBe(false);
    expect(
      rules.test(
        'throw new InputError(["config/sensors/duplication was removed"]);',
      ),
    ).toBe(true);
    expect(rules.test("const [first] = emptySections(document);")).toBe(false);
  });
});
