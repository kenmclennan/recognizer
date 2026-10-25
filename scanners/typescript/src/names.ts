import ts from "typescript";
import type { Binding, Reexport } from "./extract.js";

export function extractNames(
  sf: ts.SourceFile,
  declared: Set<string>,
  bindings: Map<string, Binding>,
) {
  const defined = new Set(declared);
  const reexports = new Map<string, Reexport>();
  const stars: string[] = [];

  for (const statement of sf.statements) {
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      defined.add("default");
    } else if (
      (ts.isClassDeclaration(statement) ||
        ts.isFunctionDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement)) &&
      (ts.getModifiers(statement) ?? []).some(
        (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
      )
    ) {
      defined.add("default");
    } else if (ts.isExportDeclaration(statement)) {
      readExportDeclaration(statement, defined, reexports, stars, bindings);
    }
  }

  return { defined, reexports, stars };
}

function readExportDeclaration(
  statement: ts.ExportDeclaration,
  defined: Set<string>,
  reexports: Map<string, Reexport>,
  stars: string[],
  bindings: Map<string, Binding>,
) {
  const source =
    statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
      ? statement.moduleSpecifier.text
      : null;
  const clause = statement.exportClause;

  if (clause && ts.isNamespaceExport(clause)) {
    defined.add(clause.name.text);
  } else if (clause && ts.isNamedExports(clause)) {
    for (const element of clause.elements) {
      const local = (element.propertyName ?? element.name).text;
      const exported = element.name.text;

      if (source !== null) {
        reexports.set(exported, { specifier: source, imported: local });
        continue;
      }

      const binding = bindings.get(local);

      if (binding && binding.form !== "namespace") {
        reexports.set(exported, {
          specifier: binding.specifier,
          imported: binding.imported,
        });
      } else {
        defined.add(exported);
      }
    }
  } else if (source !== null) {
    stars.push(source);
  }
}
