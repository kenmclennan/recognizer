import ts from "typescript";

export const VALUE_LIMIT = 40;

export type Tag = "property" | "static" | "abstract" | "async";

export interface ParamOutline {
  name: string;
  type?: string;
}

export interface FieldOutline {
  name: string;
  type?: string;
  line: number;
  private: boolean;
}

export interface MethodOutline {
  name: string;
  line: number;
  params: ParamOutline[];
  returns?: string;
  private: boolean;
  tags?: Tag[];
}

export interface MemberOutline {
  bases?: string[];
  fields?: FieldOutline[];
  methods?: MethodOutline[];
  params?: ParamOutline[];
  returns?: string;
  tags?: Tag[];
  value?: string;
}

const TAG_ORDER: Tag[] = ["property", "static", "abstract", "async"];

export function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function shorten(text: string): string {
  const collapsed = collapse(text);

  return collapsed.length <= VALUE_LIMIT
    ? collapsed
    : `${collapsed.slice(0, VALUE_LIMIT - 1)}…`;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind)
  );
}

export function propertyLabel(name: ts.PropertyName, sf: ts.SourceFile) {
  if (
    ts.isIdentifier(name) ||
    ts.isPrivateIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name) ||
    ts.isNoSubstitutionTemplateLiteral(name)
  ) {
    return name.text;
  }

  return collapse(name.getText(sf));
}

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function parameterName(
  parameter: ts.ParameterDeclaration,
  sf: ts.SourceFile,
): string {
  return ts.isIdentifier(parameter.name)
    ? parameter.name.text
    : collapse(parameter.name.getText(sf));
}

function parameters(
  list: readonly ts.ParameterDeclaration[],
  sf: ts.SourceFile,
): ParamOutline[] {
  return list
    .filter(
      (parameter) =>
        !(ts.isIdentifier(parameter.name) && parameter.name.text === "this"),
    )
    .map((parameter) => {
      const name = parameterName(parameter, sf);

      return parameter.type
        ? { name, type: collapse(parameter.type.getText(sf)) }
        : { name };
    });
}

function tagsOf(node: ts.Node, extra: Tag[] = []): Tag[] {
  const found = new Set<Tag>(extra);

  if (hasModifier(node, ts.SyntaxKind.StaticKeyword)) {
    found.add("static");
  }

  if (hasModifier(node, ts.SyntaxKind.AbstractKeyword)) {
    found.add("abstract");
  }

  if (hasModifier(node, ts.SyntaxKind.AsyncKeyword)) {
    found.add("async");
  }

  return TAG_ORDER.filter((tag) => found.has(tag));
}

export function callableOutline(
  node: ts.SignatureDeclaration,
  sf: ts.SourceFile,
): MemberOutline {
  const outline: MemberOutline = {
    params: parameters(node.parameters, sf),
  };

  if (node.type) {
    outline.returns = collapse(node.type.getText(sf));
  }

  const tags = tagsOf(node);

  if (tags.length > 0) {
    outline.tags = tags;
  }

  return outline;
}

function isPrivate(node: ts.Node, name: ts.PropertyName | undefined) {
  return (
    hasModifier(node, ts.SyntaxKind.PrivateKeyword) ||
    hasModifier(node, ts.SyntaxKind.ProtectedKeyword) ||
    (name !== undefined && ts.isPrivateIdentifier(name))
  );
}

function methodOutline(
  node: ts.MethodDeclaration | ts.MethodSignature | ts.GetAccessorDeclaration,
  sf: ts.SourceFile,
): MethodOutline {
  const extra: Tag[] = [];

  if (ts.isGetAccessorDeclaration(node)) {
    extra.push("property");
  }

  if (ts.isMethodSignature(node)) {
    extra.push("abstract");
  }

  const tags = tagsOf(node, extra);
  const method: MethodOutline = {
    name: propertyLabel(node.name, sf),
    line: lineOf(sf, node.name),
    params: parameters(node.parameters, sf),
    private: isPrivate(node, node.name),
  };

  if (node.type) {
    method.returns = collapse(node.type.getText(sf));
  }

  if (tags.length > 0) {
    method.tags = tags;
  }

  return method;
}

function constructorOutline(
  node: ts.ConstructorDeclaration,
  sf: ts.SourceFile,
): MethodOutline {
  return {
    name: "constructor",
    line: lineOf(sf, node),
    params: parameters(node.parameters, sf),
    private: isPrivate(node, undefined),
  };
}

function baseTexts(
  node: ts.ClassDeclaration | ts.InterfaceDeclaration,
  sf: ts.SourceFile,
): string[] {
  const texts: string[] = [];

  for (const token of [
    ts.SyntaxKind.ExtendsKeyword,
    ts.SyntaxKind.ImplementsKeyword,
  ]) {
    for (const clause of node.heritageClauses ?? []) {
      if (clause.token === token) {
        texts.push(...clause.types.map((type) => collapse(type.getText(sf))));
      }
    }
  }

  return texts;
}

function uniqueByName<T extends { name: string }>(items: T[]): T[] {
  const seen = new Set<string>();

  return items.filter((item) => {
    if (seen.has(item.name)) {
      return false;
    }

    seen.add(item.name);

    return true;
  });
}

export function typeOutline(
  node: ts.ClassDeclaration | ts.InterfaceDeclaration,
  sf: ts.SourceFile,
): MemberOutline {
  const fields: FieldOutline[] = [];
  const methods: MethodOutline[] = [];

  const field = (
    name: string,
    type: ts.TypeNode | undefined,
    line: number,
    isPrivateField: boolean,
  ) => {
    fields.push(
      type
        ? {
            name,
            type: collapse(type.getText(sf)),
            line,
            private: isPrivateField,
          }
        : { name, line, private: isPrivateField },
    );
  };

  for (const member of node.members) {
    if (ts.isPropertyDeclaration(member) || ts.isPropertySignature(member)) {
      field(
        propertyLabel(member.name, sf),
        member.type,
        lineOf(sf, member.name),
        ts.isPropertyDeclaration(member) && isPrivate(member, member.name),
      );
    } else if (
      ts.isMethodDeclaration(member) ||
      ts.isMethodSignature(member) ||
      ts.isGetAccessorDeclaration(member)
    ) {
      methods.push(methodOutline(member, sf));
    } else if (ts.isConstructorDeclaration(member)) {
      methods.push(constructorOutline(member, sf));

      for (const parameter of member.parameters) {
        if ((ts.getModifiers(parameter) ?? []).length > 0) {
          field(
            parameterName(parameter, sf),
            parameter.type,
            lineOf(sf, parameter.name),
            isPrivate(parameter, undefined),
          );
        }
      }
    }
  }

  return {
    bases: baseTexts(node, sf),
    fields: uniqueByName(fields),
    methods: uniqueByName(methods),
  };
}
