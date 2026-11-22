import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../../tools/scripts/temp-dirs.mjs";
import { REPO, runBin, validate } from "./helpers.js";

const SOURCE_EXTENSION = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "build",
  "test",
  "tests",
  "__tests__",
]);

function listedFiles(root: string): Set<string> {
  const output = execFileSync(
    "git",
    [
      "-C",
      root,
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
    ],
    { encoding: "utf8" },
  );

  return new Set(output.split("\0").filter((path) => path !== ""));
}

function scannedFiles(root: string): string[] {
  const listed = listedFiles(root);

  return (readdirSync(root, { recursive: true }) as string[]).filter((path) => {
    const parts = path.split(sep);
    const name = parts[parts.length - 1];

    return (
      listed.has(parts.join("/")) &&
      SOURCE_EXTENSION.test(name) &&
      !name.endsWith(".d.ts") &&
      !name.endsWith(".d.mts") &&
      !name.endsWith(".d.cts") &&
      !/\.(test|spec)\./.test(name) &&
      !parts
        .slice(0, -1)
        .some((part) => SKIPPED_DIRECTORIES.has(part) || part.startsWith("."))
    );
  });
}

function copiedFiles(root: string, withTemplates: boolean): string {
  const copy = makeTempDir("recognizer-ts-check-");

  for (const path of listedFiles(root)) {
    if (path === "" || (!withTemplates && path.startsWith("templates/"))) {
      continue;
    }

    const target = join(copy, path);

    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(root, path), target);
  }

  return copy;
}

function copiedWithoutTemplates(root: string): string {
  return copiedFiles(root, false);
}

describe("scanning check/", () => {
  const check = join(REPO, "packages/cli");

  it("describes the project's own source", () => {
    const copy = copiedWithoutTemplates(check);
    const result = runBin(copy);
    expect(result.status).toBe(0);

    const doc = JSON.parse(result.stdout);
    validate(doc);

    const sources = scannedFiles(check).filter(
      (path) => !path.startsWith("templates/"),
    );

    expect(doc.modules.length).toBe(sources.length);
    expect(
      doc.modules.every((m: { id: string }) =>
        /^(src|scripts|grammars)\//.test(m.id),
      ),
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
      "@recognizer/core",
      "ajv",
      "node:child_process",
      "node:crypto",
      "node:fs",
      "node:os",
      "node:path",
      "node:readline",
      "node:url",
      "node:util",
      "smol-toml",
      "web-tree-sitter",
      "yaml",
    ]);
    expect(
      doc.edges.some((e: { to: string }) => e.to.includes("scan.schema")),
    ).toBe(false);
  });

  it("scans check/ with its templates and skips them as unparsed template sources", () => {
    const copy = copiedFiles(check, true);
    const result = runBin(copy);

    expect(result.status).toBe(0);

    const doc = JSON.parse(result.stdout);
    validate(doc);

    const ids = doc.modules.map((m: { id: string }) => m.id);

    expect(ids.filter((id: string) => id.startsWith("templates/"))).toEqual([]);
    expect(result.stderr).not.toContain("damaged file");
  });
});
