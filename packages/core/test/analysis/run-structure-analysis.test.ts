import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Language, Parser } from "web-tree-sitter";
import {
  DEFAULT_STRUCTURE_SETTINGS,
  Finding,
  type GrammarRule,
  measuredInputs,
  type Parsers,
  type Repository,
  runStructureAnalysis,
  type SensorFindings,
  STRUCTURE_SENSOR_VERSION,
} from "../../src/index.js";
import { createFakes } from "../fakes/container.js";
import { breaching, ROOT } from "./analysis-world.js";

const GRAMMARS = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "cli",
  "grammars",
);

const PYTHON_RULE: GrammarRule = {
  name: "python",
  extensions: [".py"],
  function_types: ["function_definition"],
  scope_types: ["class_definition"],
  branch_types: ["if_statement"],
  boolean_operators: ["and", "or"],
  bound_function_types: [],
  function_names: [],
  span: null,
};

async function pythonParsers(): Promise<Parsers> {
  await Parser.init();

  const parser = new Parser();

  parser.setLanguage(await Language.load(join(GRAMMARS, "python.wasm")));

  return new Map([["python", parser]]);
}

function storedWithDuplication(repository: Repository): SensorFindings {
  const { duplication } = DEFAULT_STRUCTURE_SETTINGS;

  return {
    sensor: { name: "structure", version: STRUCTURE_SENSOR_VERSION },
    commit: "c0ffee",
    modified: false,
    settings: { duplication },
    findings: [
      Finding.stored({
        id: "duplication:kept",
        kind: "duplication",
        severity: "warning",
        principle: "dont-repeat-yourself",
        summary: "kept",
        files: ["a/x.py"],
      }),
    ],
    inputs: measuredInputs(repository),
  };
}

function duplicationIds(document: SensorFindings | null): string[] {
  return (document?.findings ?? [])
    .filter((finding) => finding.kind === "duplication")
    .map((finding) => finding.id);
}

describe("runStructureAnalysis", () => {
  it("with parsers it measures, without them it carries", async () => {
    const fakes = createFakes();
    const repository = breaching("c0ffee");
    const ports = {
      findings: fakes.findings,
      source: fakes.source,
      digest: fakes.digest,
      languages: fakes.languages,
    };
    const input = {
      say: () => {},
      root: ROOT,
      repository,
      policy: null,
      settings: DEFAULT_STRUCTURE_SETTINGS,
      rules: [PYTHON_RULE],
    };

    fakes.source.files.set(`${ROOT}/a/x.py`, "import b.y\n");
    fakes.source.files.set(`${ROOT}/b/y.py`, "x = 1\n");
    fakes.findings.save(ROOT, storedWithDuplication(repository));

    const carried = runStructureAnalysis(ports, { ...input, parsers: null });

    expect(carried.error).toBeNull();
    expect(duplicationIds(carried.sensed.document)).toEqual([
      "duplication:kept",
    ]);
    expect(duplicationIds(fakes.findings.readStructure())).toEqual([
      "duplication:kept",
    ]);
    expect(fakes.findings.overlays).toHaveLength(0);

    const measured = runStructureAnalysis(ports, {
      ...input,
      parsers: await pythonParsers(),
    });

    expect(measured.error).toBeNull();
    expect(duplicationIds(measured.sensed.document)).toEqual([]);
    expect(duplicationIds(fakes.findings.readStructure())).toEqual([]);
    expect(fakes.findings.overlays).toHaveLength(1);
  });
});
