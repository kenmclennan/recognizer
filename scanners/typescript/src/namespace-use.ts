import ts from "typescript";

export function namespaceNames(
  checker: ts.TypeChecker,
  sf: ts.SourceFile,
  alias: ts.Identifier,
): string[] | null {
  const symbol = checker.getSymbolAtLocation(alias);

  if (!symbol) {
    return null;
  }

  const names = new Set<string>();
  let escapes = false;

  const visit = (node: ts.Node) => {
    if (escapes) {
      return;
    }

    if (ts.isIdentifier(node) && node !== alias && node.text === alias.text) {
      const parent = node.parent;
      const reference = ts.isShorthandPropertyAssignment(parent)
        ? checker.getShorthandAssignmentValueSymbol(parent)
        : checker.getSymbolAtLocation(node);

      if (reference === symbol) {
        const name = accessedName(node);

        if (name === null) {
          escapes = true;
        } else {
          names.add(name);
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sf);

  return escapes || names.size === 0 ? null : [...names];
}

function accessedName(node: ts.Identifier): string | null {
  const parent = node.parent;

  if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
    return parent.name.text;
  }

  if (ts.isQualifiedName(parent) && parent.left === node) {
    return parent.right.text;
  }

  if (
    ts.isElementAccessExpression(parent) &&
    parent.expression === node &&
    (ts.isStringLiteral(parent.argumentExpression) ||
      ts.isNoSubstitutionTemplateLiteral(parent.argumentExpression))
  ) {
    return parent.argumentExpression.text;
  }

  return null;
}
