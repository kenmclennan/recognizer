import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect } from "vitest";
import { type ScanDocument, type ScanEdge, scan } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));

export const REPO = resolve(here, "../../..");
export const PACKAGE = resolve(here, "..");
export const SCHEMA_PATH = join(REPO, "schema/scan.schema.json");
export const FIXTURE = join(REPO, "fixtures/typescript");
export const BIN = join(PACKAGE, "dist/bin.js");

const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));

export const ajvValidate = new Ajv2020({ allErrors: true }).compile(schema);

export function readJson(path: string): ScanDocument {
  return JSON.parse(readFileSync(path, "utf8")) as ScanDocument;
}

export function validate(doc: ScanDocument): void {
  expect(ajvValidate(doc), JSON.stringify(ajvValidate.errors)).toBe(true);

  const ids = doc.modules.map((m) => m.id);
  expect(new Set(ids).size).toBe(ids.length);

  const foreignIds = doc.foreign.map((f) => f.id);
  expect(new Set(foreignIds).size).toBe(foreignIds.length);

  for (const node of doc.foreign) {
    expect(node.id).toBe(`foreign:${node.name}`);
  }

  for (const id of ids) {
    expect(id.startsWith("./") || id.startsWith("/") || id.includes("\\")).toBe(
      false,
    );
  }

  for (const edge of doc.edges) {
    expect(ids).toContain(edge.from);
    expect([...ids, ...foreignIds]).toContain(edge.to);

    for (const step of edge.via ?? []) {
      expect(ids).toContain(step);
    }

    if (edge.inferred) {
      expect(edge.names).toEqual(edge.inferred.methods);
    }
  }
}

export function makeTree(
  files: Record<string, string>,
  symlinks: Record<string, string> = {},
): string {
  const root = mkdtempSync(join(tmpdir(), "recognizer-ts-"));

  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }

  for (const [path, target] of Object.entries(symlinks)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    symlinkSync(join(root, target), join(root, path));
  }

  return root;
}

export function scanTree(
  files: Record<string, string>,
  symlinks: Record<string, string> = {},
): ScanDocument {
  const doc = scan(makeTree(files, symlinks), null);
  validate(doc);

  return doc;
}

export function edgeList(doc: ScanDocument, from?: string): string[] {
  return doc.edges
    .filter((edge) => from === undefined || edge.from === from)
    .map(describe);
}

function describe(edge: ScanEdge): string {
  const heritage = edge.member ? ` ${edge.member}->${edge.to_member}` : "";

  return `${edge.from} ${edge.kind} ${edge.to} @${edge.line}${heritage}`;
}

export function depends(doc: ScanDocument, from: string) {
  return doc.edges
    .filter((edge) => edge.from === from && edge.kind === "depends")
    .map((edge) => ({
      to: edge.to,
      line: edge.line,
      names: edge.names,
      via: edge.via,
      inferred: edge.inferred,
    }));
}

export function runBin(root: string, ...extra: string[]) {
  return spawnSync("node", [BIN, root, ...extra], { encoding: "utf8" });
}

export function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true }) as string[];
}

export const NODE16 = JSON.stringify({
  compilerOptions: { module: "Node16", moduleResolution: "Node16" },
});

export const BUNDLER = JSON.stringify({
  compilerOptions: { module: "ESNext", moduleResolution: "Bundler" },
});
