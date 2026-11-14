import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { allFormulae, loadUnits, parseUnits } from "./units.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const UNITS = loadUnits(ROOT);
const FORMULAE = allFormulae(UNITS);

function workflows() {
  const dir = join(ROOT, ".github/workflows");

  return readdirSync(dir)
    .filter((name) => name.endsWith(".yml"))
    .map((name) => ({
      name,
      text: readFileSync(join(dir, name), "utf8"),
    }));
}

function declaredName(text) {
  return /^name:\s*(\S+)/m.exec(text)[1];
}

function pushPaths(text) {
  const push = /^ {2}push:\n([\s\S]*?)(?=^ {2}\S|^\S|(?![\s\S]))/m.exec(text);
  const paths = /^ {4}paths:\n((?: {6}- .*\n)+)/m.exec(push?.[1] ?? "");

  return (paths?.[1] ?? "")
    .split("\n")
    .map((line) => line.replace(/^ {6}- /, "").trim())
    .filter((line) => line !== "");
}

describe("packaging/units.json", () => {
  it("holds seven units and nine formulae named by the design", () => {
    expect(UNITS.map(({ unit }) => unit)).toEqual([
      "scan-python",
      "scan-typescript",
      "scan-kotlin",
      "scan-csharp",
      "scan-rust",
      "sensors",
      "describe-claude",
    ]);
    expect(FORMULAE.map(({ formula }) => formula).sort()).toEqual([
      "recognizer-describe-claude",
      "recognizer-scan-csharp",
      "recognizer-scan-kotlin",
      "recognizer-scan-python",
      "recognizer-scan-rust",
      "recognizer-scan-typescript",
      "recognizer-sense-crap",
      "recognizer-sense-mutation",
      "recognizer-sense-thresholds",
    ]);
  });

  it("names a CI workflow for every unit whose push paths hold the unit's folder", () => {
    for (const { unit, folder, ci_workflow: ci } of UNITS) {
      const match = workflows().find(({ text }) => declaredName(text) === ci);

      expect(match, `${unit}: no workflow named ${ci}`).toBeDefined();
      expect(pushPaths(match.text), `${unit}: ${ci} push paths`).toContain(
        `${folder}/**`,
      );
    }
  });

  it("has a release-<unit> workflow naming each unit", () => {
    for (const { unit } of UNITS) {
      const file = workflows().find(
        ({ name }) => name === `release-${unit}.yml`,
      );

      expect(file, `release-${unit}.yml`).toBeDefined();
      expect(file.text).toContain(unit);
    }
  });

  it("matches the plugins matrix of check.yml", () => {
    const check = workflows().find(({ name }) => name === "check.yml").text;
    const matrix = /^ {2}plugins:[\s\S]*?unit:\s*\[([^\]]*)\]/m.exec(check)[1];

    expect(matrix.split(",").map((name) => name.trim())).toEqual(
      UNITS.map(({ unit }) => unit),
    );
  });

  it("equals the shipped sensors of the CLI", () => {
    const source = readFileSync(
      join(ROOT, "check/src/shipped-sensors.ts"),
      "utf8",
    );
    const list = /SHIPPED_SENSORS[^=]*=\s*\[([^\]]*)\]/.exec(source)[1];
    const shipped = [...list.matchAll(/"([a-z0-9-]+)"/g)].map(
      ([, name]) => `recognizer-sense-${name}`,
    );
    const sensors = FORMULAE.filter(({ unit }) => unit === "sensors").map(
      ({ formula }) => formula,
    );

    expect(shipped.length).toBeGreaterThan(0);
    expect(sensors.sort()).toEqual([...new Set(shipped)].sort());
  });

  it("states each plugin's install line as a brew upgrade or install of its own formula", () => {
    const files = {
      "scan-python": "scanners/python/src/recognizer_scan_python/manifest.py",
      "scan-kotlin": "scanners/kotlin/src/recognizer_scan_kotlin/manifest.py",
      "scan-csharp": "scanners/csharp/src/recognizer_scan_csharp/manifest.py",
      "scan-typescript": "scanners/typescript/src/manifest.ts",
      "scan-rust": "scanners/rust/src/manifest.rs",
      "describe-claude": "describers/claude/src/manifest.ts",
      sensors: "sensors/src/recognizer_sensors/manifest.py",
    };

    for (const { unit, formula } of FORMULAE) {
      const text = readFileSync(join(ROOT, files[unit]), "utf8").replace(
        /"\s*\n\s*"/g,
        "",
      );

      if (unit === "sensors") {
        expect(text).toContain("kenmclennan/tap/recognizer-sense-");
        continue;
      }

      expect(text).toContain(`kenmclennan/tap/${formula}`);
    }
  });
});

describe("parseUnits", () => {
  const unit = {
    unit: "x",
    folder: "check",
    ci_workflow: "x",
    runtime: null,
    formulae: [{ formula: "f", command: "f", desc: "d" }],
  };

  function text(...units) {
    return JSON.stringify({ units });
  }

  it("accepts a well-formed file", () => {
    expect(parseUnits(text(unit), ROOT)).toHaveLength(1);
  });

  it("refuses a duplicate formula name, naming it", () => {
    const other = {
      ...unit,
      unit: "y",
      formulae: [{ formula: "f", command: "g", desc: "d" }],
    };

    expect(() => parseUnits(text(unit, other), ROOT)).toThrow(
      /formula f is listed twice/,
    );
  });

  it("refuses a missing folder, naming the unit", () => {
    expect(() =>
      parseUnits(text({ ...unit, folder: "no/such/folder" }), ROOT),
    ).toThrow(/unit x names a folder that does not exist: no\/such\/folder/);
  });

  it("refuses a runtime that is neither a string nor null, naming the unit", () => {
    expect(() => parseUnits(text({ ...unit, runtime: 3 }), ROOT)).toThrow(
      /unit x has a runtime that is neither a string nor null/,
    );
  });
});
