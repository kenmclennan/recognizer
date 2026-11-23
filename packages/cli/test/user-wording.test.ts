import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { REPO } from "./helpers.js";

const WORD = /(?<![\w-])modules?(?![\w-])/i;
const EXCLUSIONS = join(REPO, "packages/cli/test/user-wording-exclusions.txt");

type Hit = { path: string; token: string };

const CONTRACT = [
  /\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/g,
  /<modules?[^>]*>/g,
  /--modules\b/g,
  /recognizer modules\b/g,
  /\bmodules?::/g,
];

function wordIn(text: string): boolean {
  let rest = text;

  for (const contract of CONTRACT) {
    rest = rest.replace(contract, (shape) => (WORD.test(shape) ? "" : shape));
  }

  return WORD.test(rest);
}

function isModuleSpecifier(node: ts.Node): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) {
    return true;
  }
  if (ts.isLiteralTypeNode(parent) && ts.isImportTypeNode(parent.parent)) {
    return true;
  }
  if (ts.isCallExpression(parent)) {
    const callee = parent.expression;
    return (
      callee.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(callee) && callee.text === "require")
    );
  }
  return false;
}

export function stringTokens(source: string, fileName = "x.ts"): string[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: string[] = [];

  const visit = (node: ts.Node): void => {
    const isText =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node);

    if (isText && !isModuleSpecifier(node)) {
      found.push(node.text);
    }

    ts.forEachChild(node, visit);
  };

  visit(file);

  return found;
}

export function moduleWordTokens(source: string, fileName = "x.ts"): string[] {
  return stringTokens(source, fileName).filter(wordIn);
}

export function moduleWordInValues(value: unknown): string[] {
  if (typeof value === "string") return wordIn(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(moduleWordInValues);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(moduleWordInValues);
  }
  return [];
}

export function moduleWordInMarkdown(text: string): string[] {
  const found: string[] = [];
  let fenced = false;

  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;

    const prose = line.replace(/`[^`]*`/g, "");

    if (wordIn(prose)) found.push(line);
  }

  return found;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);

    if (entry.isDirectory()) {
      return ["generated", "node_modules", "dist"].includes(entry.name)
        ? []
        : walk(full);
    }

    return [full];
  });
}

const PYTHON_ROOTS = [
  "packages/sensors/src",
  "packages/scanners/python/src",
  "packages/scanners/kotlin/src",
  "packages/scanners/csharp/src",
];
const RUST_ROOT = "packages/scanners/rust/src";
const PYTHON_HELPER = join(REPO, "packages/cli/test/python-strings.py");

export function pythonStrings(
  files: string[],
  source?: string,
): Record<string, string[]> {
  if (source !== undefined) {
    const out = execFileSync("python3", ["-I", PYTHON_HELPER, "--stdin"], {
      input: source,
      encoding: "utf8",
    });

    return JSON.parse(out);
  }

  const out = execFileSync("python3", ["-I", PYTHON_HELPER, ...files], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

  return JSON.parse(out);
}

export function pythonWordTokens(source: string): string[] {
  return (pythonStrings([], source)["<stdin>"] ?? []).filter(wordIn);
}

export function rustWordTokens(source: string): string[] {
  return [...source.matchAll(/"((?:[^"\\]|\\.)*)"/g)]
    .map((match) => match[1] ?? "")
    .filter(wordIn);
}

function walkWithin(roots: string[], pattern: RegExp): string[] {
  return roots
    .flatMap((dir) => walk(join(REPO, dir)))
    .filter(
      (path) =>
        pattern.test(path) &&
        !/[\\/](tests|\.venv|wheelhouse|__pycache__)[\\/]/.test(path),
    );
}

function sourceFiles(): string[] {
  return [
    "packages/app/src",
    "packages/cli/src",
    "packages/core/src",
    "packages/describers/claude/src",
    "packages/scanners/typescript/src",
  ]
    .flatMap((dir) => walk(join(REPO, dir)))
    .filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path));
}

function markdownFiles(): string[] {
  return [
    join(REPO, "README.md"),
    join(REPO, "packages/cli/README.md"),
    join(REPO, "packages/sensors/README.md"),
    join(REPO, "packages/describers/claude/prompt.md"),
    ...readdirSync(join(REPO, "packages/scanners"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(REPO, "packages/scanners", entry.name, "README.md")),
    ...readdirSync(join(REPO, "docs"))
      .filter((name) => name.endsWith(".md"))
      .map((name) => join(REPO, "docs", name)),
  ];
}

function readExclusions(): Hit[] {
  const lines = readFileSync(EXCLUSIONS, "utf8").split("\n");
  const start = lines.indexOf("# Permanent exclusions");

  return lines
    .slice(start + 1)
    .filter((line) => line.trim() !== "" && !line.startsWith("#"))
    .map((line) => {
      const parts = line.split("|");

      return {
        path: parts[0] ?? "",
        token: parts.slice(1, -1).join("|"),
      };
    });
}

function staleExclusions(exclusions: Hit[], hits: Hit[]): Hit[] {
  return exclusions.filter(
    (entry) =>
      !hits.some((hit) => hit.path === entry.path && hit.token === entry.token),
  );
}

function offending(exclusions: Hit[], hits: Hit[]): Hit[] {
  return hits.filter(
    (hit) =>
      !exclusions.some(
        (entry) => entry.path === hit.path && entry.token === hit.token,
      ),
  );
}

function collectHits(): Hit[] {
  const hits: Hit[] = [];

  for (const path of sourceFiles()) {
    for (const token of moduleWordTokens(readFileSync(path, "utf8"), path)) {
      hits.push({ path: relative(REPO, path), token });
    }
  }

  const pythonFiles = walkWithin(PYTHON_ROOTS, /\.py$/);
  const strings = pythonStrings(pythonFiles);

  for (const path of pythonFiles) {
    for (const token of (strings[path] ?? []).filter(wordIn)) {
      hits.push({ path: relative(REPO, path), token });
    }
  }

  for (const path of walkWithin([RUST_ROOT], /\.rs$/)) {
    for (const token of rustWordTokens(readFileSync(path, "utf8"))) {
      hits.push({ path: relative(REPO, path), token });
    }
  }

  const groups = join(REPO, "packages/app/src/finding-groups.json");

  for (const token of moduleWordInValues(
    JSON.parse(readFileSync(groups, "utf8")),
  )) {
    hits.push({ path: relative(REPO, groups), token });
  }

  for (const path of markdownFiles()) {
    for (const token of moduleWordInMarkdown(readFileSync(path, "utf8"))) {
      hits.push({ path: relative(REPO, path), token });
    }
  }

  return hits;
}

describe("user wording", () => {
  it("source text and markdown carry no user-visible module", () => {
    const explorer = readFileSync(
      join(REPO, "packages/app/src/explorer.ts"),
      "utf8",
    );
    const visited = stringTokens(explorer).filter((token) =>
      /\bfiles?\b/.test(token),
    );
    const exclusions = readExclusions();
    const hits = collectHits();

    const pythonFiles = walkWithin(PYTHON_ROOTS, /\.py$/);
    const pythonSeen = pythonStrings(
      pythonFiles.filter((path) => path.includes("packages/sensors/src")),
    );
    const rustKeys = walkWithin([RUST_ROOT], /\.rs$/).flatMap((path) =>
      [...readFileSync(path, "utf8").matchAll(/"modules?"/g)].map(
        (match) => match[0],
      ),
    );

    expect(visited.length).toBeGreaterThan(0);
    expect(
      Object.values(pythonSeen).reduce((sum, list) => sum + list.length, 0),
    ).toBeGreaterThan(0);
    expect(rustKeys.length).toBeGreaterThan(0);
    expect(exclusions.length).toBeGreaterThan(0);
    expect(offending(exclusions, hits)).toEqual([]);
    expect(staleExclusions(exclusions, hits)).toEqual([]);
  });

  it("the source walk reaches core's source", () => {
    expect(sourceFiles()).toContain(
      join(REPO, "packages/core/src/domain/run/scan-request.ts"),
    );
  });

  it("the guard flags a module word in a string but not in an identifier or comment", () => {
    const source = [
      "// a module comment",
      "const moduleId = 1;",
      "const text = `$" + "{moduleId} modules left`;",
      "const key = 'modules-tip';",
    ].join("\n");

    expect(moduleWordTokens(source)).toEqual([" modules left"]);
  });

  it("the guard flags a module word in a Python string but not in an identifier, comment or docstring", () => {
    const source = [
      "# a module comment",
      '"""module docstring"""',
      "module_id = 1",
      "def f(n):",
      '    """a modules docstring"""',
      '    return f"{n} modules left"',
    ].join("\n");

    expect(pythonWordTokens(source)).toEqual([" modules left"]);
  });

  it("the guard flags a module word in a Rust string", () => {
    const source = [
      "// a modules comment",
      'let _ = "scoped to modules";',
    ].join("\n");

    expect(rustWordTokens(source)).toEqual(["scoped to modules"]);
  });

  it("a stale exclusion fails", () => {
    const exclusions = [{ path: "a.ts", token: "gone modules" }];

    expect(staleExclusions(exclusions, [])).toEqual(exclusions);
    expect(staleExclusions(exclusions, exclusions)).toEqual([]);
  });
});
