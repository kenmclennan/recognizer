import ts from "typescript";
import type { Binding, Heritage } from "./extract.js";

export function supertypeKey(specifier: string, name: string): string {
  return `${specifier}\0${name}`;
}

function heritageExpressions(sf: ts.SourceFile): Set<ts.Node> {
  const expressions = new Set<ts.Node>();

  for (const statement of sf.statements) {
    if (!ts.isClassDeclaration(statement)) {
      continue;
    }

    for (const clause of statement.heritageClauses ?? []) {
      for (const type of clause.types) {
        const expression = type.expression;

        if (
          ts.isIdentifier(expression) ||
          (ts.isPropertyAccessExpression(expression) &&
            ts.isIdentifier(expression.expression))
        ) {
          expressions.add(expression);
        }
      }
    }
  }

  return expressions;
}

export function supertypeOnly(
  sf: ts.SourceFile,
  bindings: Map<string, Binding>,
  heritage: Heritage[],
): Set<string> {
  if (heritage.length === 0) {
    return new Set();
  }

  const skipped = heritageExpressions(sf);
  const used = new Set<string>();
  const bare = new Set<string>();
  const accessed = new Set<string>();

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || skipped.has(node)) {
      return;
    }

    if (ts.isIdentifier(node)) {
      const parent = node.parent;

      if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
        return;
      }

      used.add(node.text);

      if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
        accessed.add(`${node.text}.${parent.name.text}`);
      } else {
        bare.add(node.text);
      }

      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sf);

  const verdicts = new Map<string, boolean>();

  for (const entry of heritage) {
    const binding = bindings.get(entry.local);

    if (!binding) {
      continue;
    }

    let name: string;
    let only: boolean;

    if (binding.form === "namespace") {
      if (entry.property === null) {
        continue;
      }

      name = entry.property;
      only = !bare.has(entry.local) && !accessed.has(`${entry.local}.${name}`);
    } else {
      if (entry.property !== null) {
        continue;
      }

      name = binding.imported;
      only = !used.has(entry.local);
    }

    const key = supertypeKey(binding.specifier, name);

    verdicts.set(key, (verdicts.get(key) ?? true) && only);
  }

  for (const [local, binding] of bindings) {
    const name = binding.imported;
    const key = supertypeKey(binding.specifier, name);

    if (
      binding.form !== "namespace" &&
      verdicts.has(key) &&
      !heritage.some((entry) => entry.local === local)
    ) {
      verdicts.set(key, false);
    }
  }

  return new Set([...verdicts].filter(([, only]) => only).map(([key]) => key));
}
