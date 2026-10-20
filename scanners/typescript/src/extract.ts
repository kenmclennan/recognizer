import ts from "typescript";

export type MemberKind =
  | "class"
  | "function"
  | "interface"
  | "type"
  | "constant";

export interface Member {
  name: string;
  kind: MemberKind;
  line: number;
  exported: boolean;
  abstraction: boolean;
}

export interface ImportRef {
  specifier: string;
  line: number;
  commonjs: boolean;
}

export interface Binding {
  specifier: string;
  form: "default" | "named" | "namespace";
  imported: string;
}

export interface Heritage {
  kind: "inherits" | "implements";
  member: string;
  line: number;
  local: string;
  property: string | null;
}

export interface FileInfo {
  members: Member[];
  defaultName: string;
  imports: ImportRef[];
  bindings: Map<string, Binding>;
  heritage: Heritage[];
}

function lineOf(sf: ts.SourceFile, position: number): number {
  return sf.getLineAndCharacterOfPosition(position).line + 1;
}

function startLine(sf: ts.SourceFile, node: ts.Node): number {
  return lineOf(sf, node.getStart(sf));
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind)
  );
}

function literalText(node: ts.Node | undefined): string | undefined {
  if (
    node &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
  ) {
    return node.text;
  }

  return undefined;
}

function collectImports(sf: ts.SourceFile): ImportRef[] {
  const imports: ImportRef[] = [];

  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push({
        specifier: node.moduleSpecifier.text,
        line: startLine(sf, node),
        commonjs: false,
      });
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      imports.push({
        specifier: node.moduleReference.expression.text,
        line: startLine(sf, node),
        commonjs: true,
      });
    } else if (ts.isCallExpression(node)) {
      const argument = node.arguments[0];
      const specifier = literalText(argument);

      if (argument && specifier !== undefined) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          imports.push({
            specifier,
            line: startLine(sf, argument),
            commonjs: false,
          });
        } else if (
          ts.isIdentifier(node.expression) &&
          node.expression.text === "require"
        ) {
          imports.push({
            specifier,
            line: startLine(sf, argument),
            commonjs: true,
          });
        }
      }
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      imports.push({
        specifier: node.argument.literal.text,
        line: startLine(sf, node.argument.literal),
        commonjs: false,
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(sf);

  return imports;
}

function collectBindings(sf: ts.SourceFile): Map<string, Binding> {
  const bindings = new Map<string, Binding>();

  for (const statement of sf.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }

    const specifier = statement.moduleSpecifier.text;
    const clause = statement.importClause;

    if (!clause) {
      continue;
    }

    if (clause.name) {
      bindings.set(clause.name.text, {
        specifier,
        form: "default",
        imported: "default",
      });
    }

    const named = clause.namedBindings;

    if (named && ts.isNamespaceImport(named)) {
      bindings.set(named.name.text, {
        specifier,
        form: "namespace",
        imported: "*",
      });
    } else if (named) {
      for (const element of named.elements) {
        const imported = (element.propertyName ?? element.name).text;

        bindings.set(element.name.text, {
          specifier,
          form: imported === "default" ? "default" : "named",
          imported,
        });
      }
    }
  }

  return bindings;
}

function bindingNames(name: ts.BindingName): ts.Identifier[] {
  if (ts.isIdentifier(name)) {
    return [name];
  }

  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : bindingNames(element.name),
  );
}

function isFunctionValue(node: ts.Expression | undefined): boolean {
  return (
    node !== undefined &&
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node))
  );
}

function declaredNames(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();

  for (const statement of sf.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const identifier of bindingNames(declaration.name)) {
          names.add(identifier.text);
        }
      }
    } else if (
      (ts.isClassDeclaration(statement) ||
        ts.isFunctionDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name
    ) {
      names.add(statement.name.text);
    }
  }

  return names;
}

function heritageOf(
  declaration: ts.ClassDeclaration,
  member: string,
  line: number,
): Heritage[] {
  const found: Heritage[] = [];

  for (const clause of declaration.heritageClauses ?? []) {
    const kind =
      clause.token === ts.SyntaxKind.ExtendsKeyword ? "inherits" : "implements";

    for (const type of clause.types) {
      const expression = type.expression;

      if (ts.isIdentifier(expression)) {
        found.push({
          kind,
          member,
          line,
          local: expression.text,
          property: null,
        });
      } else if (
        ts.isPropertyAccessExpression(expression) &&
        ts.isIdentifier(expression.expression)
      ) {
        found.push({
          kind,
          member,
          line,
          local: expression.expression.text,
          property: expression.name.text,
        });
      }
    }
  }

  return found;
}

export function extract(sf: ts.SourceFile): FileInfo {
  const declared = declaredNames(sf);
  const members: Member[] = [];
  const heritage: Heritage[] = [];
  const exportedNames = new Set<string>();
  let defaultName: string | null = null;

  const add = (member: Member) => {
    const existing = members.find(
      (candidate) =>
        candidate.name === member.name && candidate.kind === member.kind,
    );

    if (existing) {
      existing.exported = existing.exported || member.exported;
    } else {
      members.push(member);
    }
  };

  const isDefault = (node: ts.Node) =>
    hasModifier(node, ts.SyntaxKind.DefaultKeyword);
  const isExported = (node: ts.Node) =>
    hasModifier(node, ts.SyntaxKind.ExportKeyword) || isDefault(node);

  for (const statement of sf.statements) {
    if (
      ts.isClassDeclaration(statement) ||
      ts.isFunctionDeclaration(statement)
    ) {
      const named = statement.name !== undefined;
      const name = statement.name?.text ?? "default";
      const line = named
        ? startLine(sf, statement.name as ts.Node)
        : startLine(sf, statement);
      const kind: MemberKind = ts.isClassDeclaration(statement)
        ? "class"
        : "function";

      add({
        name,
        kind,
        line,
        exported: isExported(statement),
        abstraction: false,
      });

      if (isDefault(statement)) {
        defaultName = name;
      }

      if (ts.isClassDeclaration(statement)) {
        heritage.push(...heritageOf(statement, name, line));
      }
    } else if (
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement)
    ) {
      add({
        name: statement.name.text,
        kind: ts.isInterfaceDeclaration(statement) ? "interface" : "type",
        line: startLine(sf, statement.name),
        exported: isExported(statement),
        abstraction: true,
      });

      if (isDefault(statement)) {
        defaultName = statement.name.text;
      }
    } else if (ts.isEnumDeclaration(statement)) {
      add({
        name: statement.name.text,
        kind: "type",
        line: startLine(sf, statement.name),
        exported: isExported(statement),
        abstraction: false,
      });
    } else if (ts.isVariableStatement(statement)) {
      const exported = isExported(statement);

      for (const declaration of statement.declarationList.declarations) {
        const kind: MemberKind =
          ts.isIdentifier(declaration.name) &&
          isFunctionValue(declaration.initializer)
            ? "function"
            : "constant";

        for (const identifier of bindingNames(declaration.name)) {
          add({
            name: identifier.text,
            kind,
            line: startLine(sf, identifier),
            exported,
            abstraction: false,
          });
        }
      }
    } else if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      const expression = statement.expression;

      if (ts.isIdentifier(expression) && declared.has(expression.text)) {
        exportedNames.add(expression.text);
        defaultName = expression.text;
      } else {
        add({
          name: "default",
          kind: isFunctionValue(expression) ? "function" : "constant",
          line: startLine(sf, statement),
          exported: true,
          abstraction: false,
        });
        defaultName = "default";
      }
    } else if (
      ts.isExportDeclaration(statement) &&
      !statement.moduleSpecifier &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        const local = (element.propertyName ?? element.name).text;

        exportedNames.add(local);

        if (element.name.text === "default") {
          defaultName = local;
        }
      }
    }
  }

  for (const member of members) {
    if (exportedNames.has(member.name)) {
      member.exported = true;
    }
  }

  return {
    members,
    defaultName: defaultName ?? "default",
    imports: collectImports(sf),
    bindings: collectBindings(sf),
    heritage,
  };
}
