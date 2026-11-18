import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { REPO } from "./helpers.js";

const WORD = /(?<![\w-])modules?(?![\w-])/i;
const EXCLUSIONS = join(REPO, "check/test/user-wording-exclusions.txt");

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

function sourceFiles(): string[] {
  return ["app/src", "check/src"]
    .flatMap((dir) => walk(join(REPO, dir)))
    .filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path));
}

function markdownFiles(): string[] {
  return [
    join(REPO, "README.md"),
    join(REPO, "check/README.md"),
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

  const groups = join(REPO, "app/src/finding-groups.json");

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
    const explorer = readFileSync(join(REPO, "app/src/explorer.ts"), "utf8");
    const visited = stringTokens(explorer).filter((token) =>
      /\bfiles?\b/.test(token),
    );
    const exclusions = readExclusions();
    const hits = collectHits();

    expect(visited.length).toBeGreaterThan(0);
    expect(exclusions.length).toBeGreaterThan(0);
    expect(offending(exclusions, hits)).toEqual([]);
    expect(staleExclusions(exclusions, hits)).toEqual([]);
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

  it("a stale exclusion fails", () => {
    const exclusions = [{ path: "a.ts", token: "gone modules" }];

    expect(staleExclusions(exclusions, [])).toEqual(exclusions);
    expect(staleExclusions(exclusions, exclusions)).toEqual([]);
  });
});
