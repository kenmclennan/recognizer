import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { runInit } from "../src/plugin-init.js";
import {
  bundledTemplates,
  KINDS,
  LANGUAGES,
  programName,
  renderTemplates,
  type TemplateKind,
  type TemplateLanguage,
  templateValues,
} from "../src/plugin-templates.js";
import { fakeIo } from "./scan-helpers.js";

const FOLDER = "/work/out";

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
).filter(([language, kind]) =>
  Object.keys(bundledTemplates()).some((key) =>
    key.startsWith(`${language}/${kind}/`),
  ),
);

function init(args: string[], files: Record<string, string> = {}) {
  const fake = fakeIo({ files });
  const status = run(["plugin", "init", ...args], fake.io);

  return { fake, status: status as number };
}

function full(kind: string, language: string, name = "demo", folder = FOLDER) {
  return ["--kind", kind, "--language", language, "--name", name, folder];
}

describe("recognizer plugin init", () => {
  it.each(PAIRS)("writes the %s %s tree", (language, kind) => {
    const { fake, status } = init(full(kind, language));
    const written = fake.writes.map((path) => path.slice(FOLDER.length + 1));
    const expected = expectedFiles(language, kind);

    expect(expected.length).toBeGreaterThan(0);
    expect(status).toBe(0);
    expect([...written].sort()).toEqual([...expected].sort());

    for (const path of fake.writes) {
      expect(fake.files.get(path)).not.toContain("{{");
      expect(path).not.toContain("{{");
    }

    expect(fake.out()).toContain("recognizer plugin check");
  });

  it.each(PAIRS)(
    "gives only the program of %s %s the mode 0o755",
    (language, kind) => {
      const { fake } = init(full(kind, language));
      const program = `recognizer-${VERB[kind]}-demo`;
      const modes = [...fake.modes.entries()];

      if (language === "rust") {
        expect(modes).toEqual([]);

        return;
      }

      expect(modes).toEqual([[join(FOLDER, program), 0o755]]);
    },
  );

  it("starts no process and registers nothing", () => {
    const { fake } = init(full("describer", "python"));

    expect(fake.calls).toEqual([]);
    expect(fake.launches).toEqual([]);
  });

  it("refuses a folder holding a hidden file, names it and writes nothing", () => {
    const { fake, status } = init(full("describer", "python"), {
      [`${FOLDER}/.hidden`]: "",
    });

    expect(status).toBe(1);
    expect(fake.err()).toContain(FOLDER);
    expect(fake.err()).toContain(".hidden");
    expect(fake.writes).toEqual([]);
  });

  it("refuses a folder path that is a file", () => {
    const { fake, status } = init(full("describer", "python"), {
      [FOLDER]: "text",
    });

    expect(status).toBe(1);
    expect(fake.err()).toContain("is a file");
    expect(fake.writes).toEqual([]);
  });

  it("creates an absent folder", () => {
    const { fake, status } = init(
      full("describer", "python", "demo", "/work/new/deep"),
    );

    expect(status).toBe(0);
    expect(fake.writes[0]?.startsWith("/work/new/deep/")).toBe(true);
  });

  it("writes into the current folder by default", () => {
    const { fake, status } = init([
      "--kind",
      "describer",
      "--language",
      "python",
      "--name",
      "demo",
    ]);

    expect(status).toBe(0);
    expect(fake.writes).toContain(
      join(process.cwd(), "recognizer-describe-demo"),
    );
  });

  it("throws before any write when a template names an unknown placeholder", () => {
    const fake = fakeIo();
    const templates = {
      ...bundledTemplates(),
      "python/describer/README.md": "hello {{nonsense}}",
    };

    expect(() =>
      runInit(full("describer", "python"), fake.io, templates),
    ).toThrow(/unknown placeholder \{\{nonsense\}\}/);
    expect(fake.writes).toEqual([]);
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
