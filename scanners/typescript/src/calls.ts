import ts from "typescript";
import type { FileInfo } from "./extract.js";
import type { Candidate, Inference } from "./inference.js";
import { type MethodOutline, propertyLabel } from "./outline.js";
import {
  isParameterProperty,
  storedOnThis,
  untypedParameters,
} from "./types-and-parameters.js";

export interface ScanCall {
  from: string;
  to: string;
  line: number;
  how: "call" | "construct" | "inferred" | "dispatch";
}

interface OutlinedMember {
  name: string;
  kind: string;
  methods?: MethodOutline[];
}

export interface CallInput {
  program: ts.Program;
  files: string[];
  idOf: (file: string) => string;
  infos: Map<string, FileInfo>;
  inference: Inference;
  members: Map<string, OutlinedMember[]>;
}

type Matches = [string, Candidate][];

interface Callable {
  caller: string;
  node: ts.SignatureDeclaration;
  body: ts.Node | undefined;
  holders: Map<string, Matches>;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isTopLevel(node: ts.Node): boolean {
  return node.parent !== undefined && ts.isSourceFile(node.parent);
}

function isFunctionValue(
  node: ts.Node | undefined,
): node is ts.ArrowFunction | ts.FunctionExpression {
  return (
    node !== undefined &&
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node))
  );
}

function isSuper(expression: ts.Expression): boolean {
  return (
    expression.kind === ts.SyntaxKind.SuperKeyword ||
    (ts.isPropertyAccessExpression(expression) &&
      expression.expression.kind === ts.SyntaxKind.SuperKeyword)
  );
}

export function findCalls(input: CallInput): ScanCall[] {
  const { program, infos, inference } = input;
  const checker = program.getTypeChecker();
  const moduleOfFile = new Map<string, string>();
  const endpoints = new Set<string>();
  const methodsOf = new Map<string, MethodOutline[]>();
  const kinds = new Map<string, string>();
  const found = new Map<string, ScanCall>();

  for (const file of input.files) {
    const source = program.getSourceFile(file);
    const id = input.idOf(file);

    if (source && !id.includes("::")) {
      moduleOfFile.set(source.fileName, id);
    }
  }

  for (const [module, members] of input.members) {
    if (module.includes("::")) {
      continue;
    }

    for (const member of members) {
      if (member.kind === "constant" || member.kind === "type") {
        continue;
      }

      const ref = `${module}::${member.name}`;

      endpoints.add(ref);
      kinds.set(ref, member.kind);
      methodsOf.set(ref, member.methods ?? []);

      for (const method of member.methods ?? []) {
        endpoints.add(`${ref}.${method.name}`);
      }
    }
  }

  const add = (call: ScanCall) => {
    if (call.from === call.to) {
      return;
    }

    found.set(`${call.from}\0${call.line}\0${call.to}\0${call.how}`, call);
  };

  const typeRef = (declaration: ts.Declaration): string | null => {
    if (
      !(
        ts.isClassDeclaration(declaration) ||
        ts.isInterfaceDeclaration(declaration)
      ) ||
      !isTopLevel(declaration)
    ) {
      return null;
    }

    const module = moduleOfFile.get(declaration.getSourceFile().fileName);

    return module ? `${module}::${declaration.name?.text ?? "default"}` : null;
  };

  const refOf = (
    declaration: ts.Declaration,
  ): { ref: string; construct: boolean } | null => {
    if (ts.isClassDeclaration(declaration)) {
      const ref = typeRef(declaration);

      return ref ? { ref, construct: true } : null;
    }

    if (
      ts.isConstructorDeclaration(declaration) &&
      ts.isClassDeclaration(declaration.parent)
    ) {
      const ref = typeRef(declaration.parent);

      return ref ? { ref, construct: true } : null;
    }

    const module = moduleOfFile.get(declaration.getSourceFile().fileName);

    if (!module) {
      return null;
    }

    if (ts.isFunctionDeclaration(declaration) && isTopLevel(declaration)) {
      return {
        ref: `${module}::${declaration.name?.text ?? "default"}`,
        construct: false,
      };
    }

    if (isFunctionValue(declaration)) {
      const owner = declaration.parent;

      if (
        ts.isVariableDeclaration(owner) &&
        ts.isIdentifier(owner.name) &&
        ts.isVariableStatement(owner.parent.parent) &&
        isTopLevel(owner.parent.parent)
      ) {
        return { ref: `${module}::${owner.name.text}`, construct: false };
      }

      if (ts.isExportAssignment(owner) && isTopLevel(owner)) {
        return { ref: `${module}::default`, construct: false };
      }

      return null;
    }

    if (
      (ts.isMethodDeclaration(declaration) ||
        ts.isMethodSignature(declaration) ||
        ts.isGetAccessorDeclaration(declaration)) &&
      (ts.isClassDeclaration(declaration.parent) ||
        ts.isInterfaceDeclaration(declaration.parent))
    ) {
      const owner = typeRef(declaration.parent);

      return owner
        ? {
            ref: `${owner}.${propertyLabel(declaration.name, declaration.getSourceFile())}`,
            construct: false,
          }
        : null;
    }

    return null;
  };

  const symbolDeclaration = (
    expression: ts.Expression,
  ): ts.Declaration | undefined => {
    const target = ts.isPropertyAccessExpression(expression)
      ? expression.name
      : expression;
    let symbol = checker.getSymbolAtLocation(target);

    if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
      symbol = checker.getAliasedSymbol(symbol);
    }

    return symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  };

  const declarationOf = (
    node: ts.CallExpression | ts.NewExpression,
  ): ts.Declaration | undefined => {
    if (ts.isNewExpression(node)) {
      return symbolDeclaration(node.expression);
    }

    const declaration = checker.getResolvedSignature(node)?.declaration;

    if (declaration && !ts.isJSDocSignature(declaration)) {
      return declaration;
    }

    return symbolDeclaration(node.expression);
  };

  const untypedMatches = (
    info: FileInfo | undefined,
    node: ts.SignatureDeclaration,
    source: ts.SourceFile,
  ): Map<string, Matches> => {
    const matches = new Map<string, Matches>();

    for (const parameter of untypedParameters(node)) {
      const name = (parameter.name as ts.Identifier).text;
      const line =
        source.getLineAndCharacterOfPosition(parameter.getStart(source)).line +
        1;
      const use = info?.parameters.find(
        (candidate) => candidate.parameter === name && candidate.line === line,
      );
      const kept = use ? inference.matchesFor([...use.methods]) : [];

      if (kept.length > 0) {
        matches.set(name, kept);
      }
    }

    return matches;
  };

  const collect = (
    module: string,
    source: ts.SourceFile,
    info: FileInfo | undefined,
  ): Callable[] => {
    const callables: Callable[] = [];
    const none = new Map<string, Matches>();

    const plain = (
      name: string,
      node: ts.SignatureDeclaration,
      body: ts.Node | undefined,
    ) => {
      callables.push({
        caller: `${module}::${name}`,
        node,
        body,
        holders: none,
      });
    };

    for (const statement of source.statements) {
      if (ts.isFunctionDeclaration(statement)) {
        plain(statement.name?.text ?? "default", statement, statement.body);
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (
            ts.isIdentifier(declaration.name) &&
            isFunctionValue(declaration.initializer)
          ) {
            plain(
              declaration.name.text,
              declaration.initializer,
              declaration.initializer.body,
            );
          }
        }
      } else if (
        ts.isExportAssignment(statement) &&
        isFunctionValue(statement.expression)
      ) {
        plain("default", statement.expression, statement.expression.body);
      } else if (ts.isClassDeclaration(statement)) {
        collectClass(module, source, info, statement, callables);
      }
    }

    return callables;
  };

  const collectClass = (
    module: string,
    source: ts.SourceFile,
    info: FileInfo | undefined,
    statement: ts.ClassDeclaration,
    callables: Callable[],
  ) => {
    const className = statement.name?.text ?? "default";
    const holders = new Map<string, Matches>();
    const members = statement.members.filter(
      (
        member,
      ): member is
        | ts.MethodDeclaration
        | ts.GetAccessorDeclaration
        | ts.ConstructorDeclaration =>
        ts.isMethodDeclaration(member) ||
        ts.isGetAccessorDeclaration(member) ||
        ts.isConstructorDeclaration(member),
    );

    for (const member of members) {
      if (!member.body) {
        continue;
      }

      for (const [name, matches] of untypedMatches(info, member, source)) {
        const stored = storedOnThis(member, name);
        const parameter = member.parameters.find(
          (candidate) =>
            ts.isIdentifier(candidate.name) && candidate.name.text === name,
        );

        if (parameter && isParameterProperty(parameter)) {
          stored.add(name);
        }

        for (const attribute of stored) {
          holders.set(attribute, matches);
        }
      }
    }

    for (const member of members) {
      const label = ts.isConstructorDeclaration(member)
        ? "constructor"
        : propertyLabel(member.name, source);

      callables.push({
        caller: `${module}::${className}.${label}`,
        node: member,
        body: member.body,
        holders,
      });
    }
  };

  const inferredCalls = (
    call: ts.CallExpression,
    callable: Callable,
    untyped: Map<string, Matches>,
    from: string,
    line: number,
  ) => {
    if (!ts.isPropertyAccessExpression(call.expression)) {
      return;
    }

    const receiver = call.expression.expression;
    const method = call.expression.name.text;
    let matches: Matches | undefined;

    if (ts.isIdentifier(receiver)) {
      matches = untyped.get(receiver.text);
    } else if (
      ts.isPropertyAccessExpression(receiver) &&
      receiver.expression.kind === ts.SyntaxKind.ThisKeyword
    ) {
      matches = callable.holders.get(receiver.name.text);
    }

    for (const [key, candidate] of matches ?? []) {
      const definer = inference.definerOf(key, method) ?? candidate;

      add({
        from,
        to: `${definer.module}::${definer.decl.name}.${method}`,
        line,
        how: "inferred",
      });
    }
  };

  for (const file of input.files) {
    const source = program.getSourceFile(file);
    const module = input.idOf(file);

    if (!source || module.includes("::")) {
      continue;
    }

    const info = infos.get(module);

    for (const callable of collect(module, source, info)) {
      const untyped = untypedMatches(info, callable.node, source);

      const visit = (node: ts.Node) => {
        if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
          return;
        }

        if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
          const line =
            source.getLineAndCharacterOfPosition(node.getStart(source)).line +
            1;

          if (!isSuper(node.expression)) {
            const declaration = declarationOf(node);
            const target = declaration ? refOf(declaration) : null;

            if (target) {
              add({
                from: callable.caller,
                to: target.ref,
                line,
                how: target.construct ? "construct" : "call",
              });
            } else if (!declaration && ts.isCallExpression(node)) {
              inferredCalls(node, callable, untyped, callable.caller, line);
            }
          }
        }

        ts.forEachChild(node, visit);
      };

      if (callable.body) {
        visit(callable.body);
      }
    }
  }

  const subtypes = new Map<string, string[]>();

  for (const file of input.files) {
    const source = program.getSourceFile(file);

    if (!source) {
      continue;
    }

    for (const statement of source.statements) {
      if (
        !(
          ts.isClassDeclaration(statement) ||
          ts.isInterfaceDeclaration(statement)
        )
      ) {
        continue;
      }

      const child = typeRef(statement);

      for (const clause of statement.heritageClauses ?? []) {
        for (const type of clause.types) {
          const declaration = symbolDeclaration(type.expression);
          const parent = declaration ? typeRef(declaration) : null;

          if (child && parent) {
            subtypes.set(parent, [...(subtypes.get(parent) ?? []), child]);
          }
        }
      }
    }
  }

  for (const [owner, methods] of methodsOf) {
    for (const method of methods) {
      if (!method.tags?.includes("abstract")) {
        continue;
      }

      const pending = [...(subtypes.get(owner) ?? [])];
      const seen = new Set<string>([owner]);

      while (pending.length > 0) {
        const current = pending.pop() as string;

        if (seen.has(current)) {
          continue;
        }

        seen.add(current);
        pending.push(...(subtypes.get(current) ?? []));

        const own = (methodsOf.get(current) ?? []).find(
          (candidate) =>
            candidate.name === method.name &&
            !candidate.tags?.includes("abstract"),
        );

        if (kinds.get(current) === "class" && own) {
          add({
            from: `${owner}.${method.name}`,
            to: `${current}.${method.name}`,
            line: method.line,
            how: "dispatch",
          });
        }
      }
    }
  }

  return [...found.values()]
    .filter((call) => endpoints.has(call.from) && endpoints.has(call.to))
    .sort(
      (a, b) =>
        compare(a.from, b.from) ||
        a.line - b.line ||
        compare(a.to, b.to) ||
        compare(a.how, b.how),
    );
}
