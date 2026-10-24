import ts from "typescript";
import type { BaseRef, ParameterUse, TypeDecl } from "./extract.js";

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind)
  );
}

function refsOf(
  clauses: readonly ts.HeritageClause[] | undefined,
  token: ts.SyntaxKind,
): BaseRef[] {
  const refs: BaseRef[] = [];

  for (const clause of clauses ?? []) {
    if (clause.token !== token) {
      continue;
    }

    for (const type of clause.types) {
      const expression = type.expression;

      if (ts.isIdentifier(expression)) {
        refs.push({ local: expression.text, property: null });
      } else if (
        ts.isPropertyAccessExpression(expression) &&
        ts.isIdentifier(expression.expression)
      ) {
        refs.push({
          local: expression.expression.text,
          property: expression.name.text,
        });
      }
    }
  }

  return refs;
}

function memberName(name: ts.PropertyName | undefined): string | null {
  return name && (ts.isIdentifier(name) || ts.isStringLiteral(name))
    ? name.text
    : null;
}

function methodsOf(members: readonly ts.Node[]): Set<string> {
  const methods = new Set<string>();

  for (const member of members) {
    let name: string | null = null;

    if (ts.isMethodDeclaration(member) || ts.isMethodSignature(member)) {
      name = memberName(member.name);
    } else if (
      ts.isPropertyDeclaration(member) &&
      member.initializer &&
      (ts.isArrowFunction(member.initializer) ||
        ts.isFunctionExpression(member.initializer))
    ) {
      name = memberName(member.name);
    } else if (
      ts.isPropertySignature(member) &&
      member.type &&
      ts.isFunctionTypeNode(member.type)
    ) {
      name = memberName(member.name);
    }

    if (name !== null) {
      methods.add(name);
    }
  }

  return methods;
}

function callsOn(
  root: ts.Node,
  matches: (target: ts.Expression) => boolean,
): Set<string> {
  const called = new Set<string>();

  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      matches(node.expression.expression)
    ) {
      called.add(node.expression.name.text);
    }

    ts.forEachChild(node, visit);
  };

  visit(root);

  return called;
}

function isIdentifier(name: string) {
  return (node: ts.Expression) => ts.isIdentifier(node) && node.text === name;
}

function isThisProperty(name: string) {
  return (node: ts.Expression) =>
    ts.isPropertyAccessExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ThisKeyword &&
    node.name.text === name;
}

function storedOnThis(body: ts.Node, parameter: string): Set<string> {
  const attributes = new Set<string>();

  const visit = (node: ts.Node) => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.right) &&
      node.right.text === parameter &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.expression.kind === ts.SyntaxKind.ThisKeyword
    ) {
      attributes.add(node.left.name.text);
    }

    ts.forEachChild(node, visit);
  };

  visit(body);

  return attributes;
}

function untypedParameters(
  declaration: ts.SignatureDeclaration,
): ts.ParameterDeclaration[] {
  return declaration.parameters.filter(
    (parameter) =>
      parameter.type === undefined &&
      parameter.dotDotDotToken === undefined &&
      ts.isIdentifier(parameter.name),
  );
}

function isParameterProperty(parameter: ts.ParameterDeclaration): boolean {
  return (ts.getModifiers(parameter) ?? []).length > 0;
}

function functionLike(statement: ts.Statement): ts.SignatureDeclaration[] {
  if (ts.isFunctionDeclaration(statement) && statement.body) {
    return [statement];
  }

  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.flatMap((declaration) =>
      declaration.initializer &&
      (ts.isArrowFunction(declaration.initializer) ||
        ts.isFunctionExpression(declaration.initializer))
        ? [declaration.initializer]
        : [],
    );
  }

  return [];
}

function bodyOf(declaration: ts.SignatureDeclaration): ts.Node | undefined {
  return (declaration as { body?: ts.Node }).body;
}

export function extractTypes(sf: ts.SourceFile) {
  const types: TypeDecl[] = [];
  const parameters: ParameterUse[] = [];
  const line = (node: ts.Node) =>
    sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  for (const statement of sf.statements) {
    for (const declaration of functionLike(statement)) {
      const body = bodyOf(declaration);

      for (const parameter of untypedParameters(declaration)) {
        const name = (parameter.name as ts.Identifier).text;

        parameters.push({
          parameter: name,
          line: line(parameter),
          methods: body ? callsOn(body, isIdentifier(name)) : new Set(),
        });
      }
    }

    if (ts.isInterfaceDeclaration(statement)) {
      types.push({
        name: statement.name.text,
        kind: "interface",
        abstract: true,
        methods: methodsOf(statement.members),
        extendsList: refsOf(
          statement.heritageClauses,
          ts.SyntaxKind.ExtendsKeyword,
        ),
        implementsList: [],
      });
    }

    if (ts.isClassDeclaration(statement) && statement.name) {
      types.push({
        name: statement.name.text,
        kind: "class",
        abstract: hasModifier(statement, ts.SyntaxKind.AbstractKeyword),
        methods: methodsOf(statement.members),
        extendsList: refsOf(
          statement.heritageClauses,
          ts.SyntaxKind.ExtendsKeyword,
        ),
        implementsList: refsOf(
          statement.heritageClauses,
          ts.SyntaxKind.ImplementsKeyword,
        ),
      });
    }

    if (ts.isClassDeclaration(statement)) {
      parameters.push(...classParameters(statement, line));
    }
  }

  return { types, parameters };
}

function classParameters(
  declaration: ts.ClassDeclaration,
  line: (node: ts.Node) => number,
): ParameterUse[] {
  const uses: ParameterUse[] = [];
  const callables = declaration.members.filter(
    (member): member is ts.MethodDeclaration | ts.ConstructorDeclaration =>
      (ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member)) &&
      member.body !== undefined,
  );

  for (const callable of callables) {
    for (const parameter of untypedParameters(callable)) {
      const name = (parameter.name as ts.Identifier).text;
      const attributes = storedOnThis(callable, name);
      const methods = callsOn(callable, isIdentifier(name));

      if (isParameterProperty(parameter)) {
        attributes.add(name);
      }

      for (const attribute of attributes) {
        for (const other of callables) {
          for (const called of callsOn(other, isThisProperty(attribute))) {
            methods.add(called);
          }
        }
      }

      uses.push({ parameter: name, line: line(parameter), methods });
    }
  }

  return uses;
}
