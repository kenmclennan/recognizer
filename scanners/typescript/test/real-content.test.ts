import { readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO, runBin, validate } from "./helpers.js";

const SOURCE_EXTENSION = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "build",
  "test",
  "tests",
  "__tests__",
]);

function scannedFiles(root: string): string[] {
  return (readdirSync(root, { recursive: true }) as string[]).filter((path) => {
    const parts = path.split(sep);
    const name = parts[parts.length - 1];

    return (
      SOURCE_EXTENSION.test(name) &&
      !name.endsWith(".d.ts") &&
      !/\.(test|spec)\./.test(name) &&
      !parts
        .slice(0, -1)
        .some((part) => SKIPPED_DIRECTORIES.has(part) || part.startsWith("."))
    );
  });
}

describe("scanning check/", () => {
  const check = join(REPO, "check");

  it("describes the project's own source", () => {
    const result = runBin(check);
    expect(result.status).toBe(0);

    const doc = JSON.parse(result.stdout);
    validate(doc);

    const sources = scannedFiles(check);

    expect(doc.modules.length).toBe(sources.length);
    expect(
      doc.modules.every((m: { id: string }) => /^(src|scripts)\//.test(m.id)),
    ).toBe(true);
    expect(
      doc.edges.some(
        (e: { from: string; to: string; kind: string }) =>
          e.from === "src/bin.ts" &&
          e.to === "src/cli.ts" &&
          e.kind === "depends",
      ),
    ).toBe(true);
    expect(doc.foreign.map((f: { name: string }) => f.name)).toEqual([
      "ajv",
      "node:child_process",
      "node:crypto",
      "node:fs",
      "node:os",
      "node:path",
      "node:url",
      "node:util",
      "yaml",
    ]);
    expect(
      doc.edges.some((e: { to: string }) => e.to.includes("scan.schema")),
    ).toBe(false);
  });
});
