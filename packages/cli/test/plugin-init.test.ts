import { join } from "node:path";
import {
  KINDS,
  programName,
  renderTemplates,
  scaffoldPlugin,
  type TemplateKind,
  type TemplateLanguage,
  templateLanguages,
  templateValues as valuesOf,
} from "@recognizer/core";
import { describe, expect, it } from "vitest";
import templates from "../src/generated/templates.json" with { type: "json" };
import { documentValidators } from "../src/manifest-ports.js";
import { cliScenario } from "./support/index.js";

const templateValues = (kind: TemplateKind, name: string) =>
  valuesOf(kind, name, documentValidators.facts);

const FOLDER = "/work/out";

const LANGUAGES = templateLanguages(templates);

const VERB = { scanner: "scan", sensor: "sense", describer: "describe" };

function expectedFiles(
  language: TemplateLanguage,
  kind: TemplateKind,
): string[] {
  const program = `recognizer-${VERB[kind]}-demo`;

  if (language === "python") {
    return [program, "README.md"];
  }

  if (language === "typescript") {
    return [program, "package.json", "src/main.ts", "README.md"];
  }

  return [
    "Cargo.toml",
    "src/main.rs",
    ".gitignore",
    "README.md",
    ...(kind === "scanner" ? ["src/sha256.rs"] : []),
  ];
}

const PAIRS = LANGUAGES.flatMap((language) =>
  KINDS.map((kind) => [language, kind] as const),
);

async function init(args: string[], files: Record<string, string> = {}) {
  const scenario = cliScenario();

  for (const [path, content] of Object.entries(files)) {
    scenario.root.io.files.writeFile(path, content);
  }

  const result = await scenario.run(["plugin", "init", ...args]);

  return { scenario, result };
}

function full(kind: string, language: string, name = "demo", folder = FOLDER) {
  return ["--kind", kind, "--language", language, "--name", name, folder];
}

describe("recognizer plugin init", () => {
  it.each(PAIRS)("writes the %s %s tree", async (language, kind) => {
    const { scenario, result } = await init(full(kind, language));
    const paths = scenario.root.io.files.list(FOLDER);
    const written = paths.map((path) => path.slice(FOLDER.length + 1));
    const expected = expectedFiles(language, kind);

    expect(expected.length).toBeGreaterThan(0);
    expect(result.exit).toBe(0);
    expect([...written].sort()).toEqual([...expected].sort());

    for (const path of paths) {
      expect(scenario.read(path)).not.toContain("{{");
      expect(path).not.toContain("{{");
    }

    expect(result.out).toContain("recognizer plugin check");
  });

  it.each(PAIRS)(
    "gives only the program of %s %s the mode 0o755",
    async (language, kind) => {
      const { scenario } = await init(full(kind, language));
      const program = `recognizer-${VERB[kind]}-demo`;
      const files = scenario.root.io.files;
      const paths = files.list(FOLDER);
      const moded = paths.filter((path) => files.modeOf(path) !== undefined);

      expect(paths.length).toBeGreaterThan(0);

      if (language === "rust") {
        expect(moded).toEqual([]);

        return;
      }

      expect(moded).toEqual([join(FOLDER, program)]);
      expect(files.modeOf(join(FOLDER, program))).toBe(0o755);
    },
  );

  it.each(LANGUAGES)(
    "writes the scan schema version into the %s scanner's manifest",
    async (language) => {
      const { scenario } = await init(full("scanner", language));
      const source = scenario.root.io.files
        .list(FOLDER)
        .filter((path) => !path.endsWith("README.md"))
        .map((path) => scenario.read(path))
        .join("\n");

      const version = templateValues("scanner", "demo").scan_schema_version;

      expect(source).toMatch(
        new RegExp(`scan_schema_version\\W+${version}\\b`),
      );
    },
  );

  it("offers the bundle's languages in order with the usage text unchanged", async () => {
    expect(LANGUAGES).toEqual(["python", "typescript", "rust"]);

    const { result } = await init(["--kind", "scanner", "--name", "demo"]);

    expect(result.err).toContain(
      "usage: recognizer plugin init --kind <scanner|sensor|describer> --language <python|typescript|rust> --name <name> [folder]",
    );
    expect(result.err).toContain(
      "example: recognizer plugin init --kind scanner --language python --name mylang ./recognizer-scan-mylang",
    );
  });

  it("starts no process and registers nothing", async () => {
    const scenario = cliScenario();
    const config = ".recognizer/config.yaml";
    const before = scenario.exists(config) ? scenario.read(config) : null;
    const calls = scenario.root.io.processes.calls.length;
    const result = await scenario.run([
      "plugin",
      "init",
      ...full("scanner", "python"),
    ]);

    expect(result.exit).toBe(0);
    expect(result.out).toContain("wrote");
    expect(scenario.root.io.processes.calls.length).toBe(calls);
    expect(scenario.exists(config) ? scenario.read(config) : null).toBe(before);
  });

  it("names the build step for Rust only", async () => {
    expect((await init(full("scanner", "rust"))).result.out).toContain(
      "cargo build",
    );
    expect((await init(full("scanner", "python"))).result.out).not.toContain(
      "cargo build",
    );
  });

  it("names plugin add for a sensor and the config key only for a scanner", async () => {
    const sensor = (await init(full("sensor", "python"))).result.out;
    const scanner = (await init(full("scanner", "python"))).result.out;

    expect(sensor).toContain("recognizer plugin add demo");
    expect(scanner).toContain("recognizer config scanners.demo demo");
    expect(scanner).not.toContain("plugin add");
  });

  it.each([
    ["a missing --kind", ["--language", "python", "--name", "demo"], "--kind"],
    [
      "an unknown --language",
      ["--kind", "scanner", "--language", "go", "--name", "demo"],
      "python, typescript, rust",
    ],
    [
      "an unknown --kind",
      ["--kind", "oracle", "--language", "python", "--name", "demo"],
      "scanner, sensor, describer",
    ],
    [
      "an invalid --name",
      ["--kind", "scanner", "--language", "python", "--name", "Bad_Name"],
      "--name",
    ],
    [
      "a 65-character --name",
      ["--kind", "scanner", "--language", "python", "--name", "a".repeat(65)],
      "--name",
    ],
    [
      "an empty --name",
      ["--kind", "scanner", "--language", "python", "--name", ""],
      "--name",
    ],
    [
      "a missing --name",
      ["--kind", "scanner", "--language", "python"],
      "--name",
    ],
  ])(
    "exits 2 with the choices and an example on %s",
    async (_title, args, text) => {
      const { scenario, result } = await init(args);

      expect(result.exit).toBe(2);
      expect(result.err).toContain(text);
      expect(result.err).toContain("example: recognizer plugin init --kind");
      expect(scenario.root.io.files.list("/")).not.toContain(
        join(process.cwd(), "recognizer-scan-demo"),
      );
      expect(scenario.root.io.files.list(FOLDER)).toEqual([]);
    },
  );

  it("refuses a folder holding a hidden file, names it and writes nothing", async () => {
    const { scenario, result } = await init(full("scanner", "python"), {
      [`${FOLDER}/.hidden`]: "",
    });

    expect(result.exit).toBe(1);
    expect(result.err).toContain(FOLDER);
    expect(result.err).toContain(".hidden");
    expect(scenario.root.io.files.list(FOLDER)).toEqual([`${FOLDER}/.hidden`]);
  });

  it("refuses a folder path that is a file", async () => {
    const { scenario, result } = await init(full("scanner", "python"), {
      [FOLDER]: "text",
    });

    expect(result.exit).toBe(1);
    expect(result.err).toContain("is a file");
    expect(scenario.read(FOLDER)).toBe("text");
  });

  it("creates an absent folder", async () => {
    const { scenario, result } = await init(
      full("scanner", "python", "demo", "/work/new/deep"),
    );

    expect(result.exit).toBe(0);
    expect(
      scenario.root.io.files
        .list("/work/new/deep")
        .every((path) => path.startsWith("/work/new/deep/")),
    ).toBe(true);
    expect(
      scenario.root.io.files.list("/work/new/deep").length,
    ).toBeGreaterThan(0);
  });

  it("writes into the current folder by default", async () => {
    const { scenario, result } = await init([
      "--kind",
      "scanner",
      "--language",
      "python",
      "--name",
      "demo",
    ]);

    expect(result.exit).toBe(0);
    expect(scenario.exists(join(process.cwd(), "recognizer-scan-demo"))).toBe(
      true,
    );
  });

  it("throws before any write when a template names an unknown placeholder", () => {
    const scenario = cliScenario();
    const files = scenario.root.io.files;
    const substituted = {
      ...templates,
      "python/scanner/README.md": "hello {{nonsense}}",
    };

    expect(() =>
      scaffoldPlugin(
        {
          sandbox: files,
          templates: { bundled: () => substituted },
          validators: documentValidators,
        },
        {
          kind: "scanner",
          language: "python",
          name: "demo",
          folder: FOLDER,
        },
      ),
    ).toThrow(/unknown placeholder \{\{nonsense\}\}/);
    expect(files.list(FOLDER)).toEqual([]);
  });

  it("throws when braces remain after rendering", () => {
    const values = templateValues("scanner", "demo");

    expect(() =>
      renderTemplates(
        { "python/scanner/README.md": "open {{ never closed" },
        "python",
        "scanner",
        values,
      ),
    ).toThrow(/still holds/);
  });

  it("fills every placeholder from the protocol and schema versions", () => {
    const values = templateValues("sensor", "demo");

    expect(values.program).toBe(programName("sensor", "demo"));
    expect(Number(values.protocol)).toBeGreaterThan(0);
    expect(Number(values.scan_schema_version)).toBeGreaterThan(0);
    expect(Number(values.findings_version)).toBeGreaterThan(0);
  });
});
