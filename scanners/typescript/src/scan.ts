import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { findCalls, type ScanCall } from "./calls.js";
import { ScanError } from "./errors.js";
import { extract, type FileInfo, type Member } from "./extract.js";
import { listSourceFiles, type Selection, selection } from "./files.js";
import { Inference } from "./inference.js";
import type { MemberOutline } from "./outline.js";
import { Resolver } from "./resolve.js";
import { namedEdges, Router } from "./routes.js";
import { TsconfigOptions } from "./tsconfig-options.js";
import { scannerVersion } from "./version.js";
import { discoverWorkspaces } from "./workspaces.js";

export type { ScanCall };

export interface ScanMember extends MemberOutline {
  name: string;
  kind: Member["kind"];
  line: number;
  exported: boolean;
}

export interface ScanModule {
  id: string;
  language: "typescript";
  kind: "module" | "interface";
  members: ScanMember[];
}

export interface ScanEdge {
  from: string;
  to: string;
  kind: "depends" | "inherits" | "implements";
  line: number;
  member?: string;
  to_member?: string;
  names?: string[];
  via?: string[];
  inferred?: {
    parameter: string;
    methods: string[];
    class: string;
    implementations: string[];
  };
}

export interface ScanDocument {
  schema_version: 5;
  scanner: { name: string; version: string };
  commit: string | null;
  modified: boolean | null;
  files: { path: string; hash: string }[];
  selection: Selection;
  modules: ScanModule[];
  edges: ScanEdge[];
  foreign: { id: string; name: string }[];
  calls: ScanCall[];
}

const SCANNER_NAME = "recognizer-scan-typescript";

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function edgeKey(edge: ScanEdge): string {
  return [
    edge.from,
    edge.to,
    edge.kind,
    edge.line,
    edge.member ?? "",
    edge.to_member ?? "",
    (edge.names ?? []).join(","),
    (edge.via ?? []).join(","),
    edge.inferred?.class ?? "",
    edge.inferred?.parameter ?? "",
  ].join("\0");
}

function sortEdges(edges: ScanEdge[]): ScanEdge[] {
  return edges.sort(
    (a, b) =>
      compare(a.from, b.from) ||
      a.line - b.line ||
      compare(a.to, b.to) ||
      compare(a.kind, b.kind) ||
      compare(a.member ?? "", b.member ?? "") ||
      compare(a.to_member ?? "", b.to_member ?? "") ||
      compare(a.inferred?.class ?? "", b.inferred?.class ?? "") ||
      compare(a.inferred?.parameter ?? "", b.inferred?.parameter ?? "") ||
      compare((a.names ?? []).join(","), (b.names ?? []).join(",")),
  );
}

function extensionOf(id: string): ts.Extension {
  if (id.endsWith(".d.ts")) {
    return ts.Extension.Dts;
  }

  const map: Record<string, ts.Extension> = {
    ".tsx": ts.Extension.Tsx,
    ".mts": ts.Extension.Mts,
    ".cts": ts.Extension.Cts,
    ".jsx": ts.Extension.Jsx,
    ".mjs": ts.Extension.Mjs,
    ".cjs": ts.Extension.Cjs,
    ".js": ts.Extension.Js,
  };
  const dot = id.lastIndexOf(".");

  return map[id.slice(dot)] ?? ts.Extension.Ts;
}

function moduleKind(members: Member[]): "module" | "interface" {
  const exported = members.filter((member) => member.exported);

  return exported.length > 0 && exported.every((member) => member.abstraction)
    ? "interface"
    : "module";
}

function syntaxProblems(
  program: ts.Program,
  files: string[],
  root: string,
): string[] {
  const problems: string[] = [];

  for (const file of files) {
    const source = program.getSourceFile(file);

    if (!source) {
      continue;
    }

    for (const diagnostic of program.getSyntacticDiagnostics(source)) {
      const line =
        diagnostic.start === undefined
          ? 0
          : source.getLineAndCharacterOfPosition(diagnostic.start).line + 1;
      const message = ts.flattenDiagnosticMessageText(
        diagnostic.messageText,
        "\n",
      );

      problems.push(
        `${relative(root, file).split(sep).join("/")}:${line}: ${message}`,
      );
    }
  }

  return problems;
}

export function scan(
  root: string,
  commit: string | null,
  modified: boolean | null = null,
): ScanDocument {
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    throw new ScanError([`ROOT is not a directory: ${root}`]);
  }

  const real = realpathSync(root);
  const files = listSourceFiles(real).sort(compare);
  const idOf = (file: string) => relative(real, file).split(sep).join("/");
  const modules = new Set(files.map(idOf));

  const tsconfigs = new TsconfigOptions(real);
  const resolver = new Resolver(real, modules, discoverWorkspaces(real));
  const optionsByFile = new Map<string, ts.CompilerOptions>();

  for (const file of files) {
    optionsByFile.set(file, tsconfigs.optionsFor(file));
  }

  const located = new Map<string, string | null>();

  const locate = (module: string, specifier: string): string | null => {
    const key = `${module}\0${specifier}`;

    if (!located.has(key)) {
      const file = join(real, module);
      const options = optionsByFile.get(file);
      const target = options
        ? resolver.resolve(specifier, file, options, false)
        : null;

      located.set(key, target?.kind === "project" ? target.id : null);
    }

    return located.get(key) ?? null;
  };

  const compilerOptions: ts.CompilerOptions = {
    noResolve: true,
    noLib: true,
    allowJs: true,
    jsx: ts.JsxEmit.Preserve,
    types: [],
    noEmit: true,
  };
  const host = ts.createCompilerHost(compilerOptions);

  host.resolveModuleNameLiterals = (literals, containingFile) =>
    literals.map((literal) => {
      const container = idOf(containingFile);
      const target = modules.has(container)
        ? locate(container, literal.text)
        : null;

      return {
        resolvedModule: target
          ? {
              resolvedFileName: join(real, target),
              extension: extensionOf(target),
              isExternalLibraryImport: false,
            }
          : undefined,
      };
    });

  const program = ts.createProgram(files, compilerOptions, host);
  const infos = new Map<string, FileInfo>();

  for (const file of files) {
    const source = program.getSourceFile(file);

    if (source) {
      infos.set(idOf(file), extract(source));
    }
  }

  const problems = [
    ...syntaxProblems(program, files, real),
    ...tsconfigs.failures(),
  ];

  if (problems.length > 0) {
    throw new ScanError(problems);
  }

  const edges = new Map<string, ScanEdge>();
  const foreign = new Set<string>();

  const router = new Router(infos, locate);
  const inference = new Inference(infos, router, locate);

  const push = (edge: ScanEdge) => {
    edges.set(edgeKey(edge), edge);
  };

  for (const file of files) {
    const from = idOf(file);
    const info = infos.get(from);
    const options = optionsByFile.get(file);

    if (!info || !options) {
      continue;
    }

    const targets = new Map<string, ReturnType<Resolver["resolve"]>>();

    const targetOf = (specifier: string, commonjs: boolean) => {
      const key = `${commonjs}\0${specifier}`;
      let target = targets.get(key);

      if (!target) {
        target = resolver.resolve(specifier, file, options, commonjs);
        targets.set(key, target);
      }

      return target;
    };

    const imported = new Set<string>();

    for (const reference of info.imports) {
      const target = targetOf(reference.specifier, reference.commonjs);

      if (target.kind === "project" && target.id !== from) {
        if (reference.names === null) {
          imported.add(target.id);
          push({ from, to: target.id, kind: "depends", line: reference.line });
        }

        for (const named of reference.names === null
          ? []
          : namedEdges(from, target.id, reference.names, router)) {
          imported.add(named.to);
          push({
            from,
            to: named.to,
            kind: "depends",
            line: reference.line,
            names: named.names,
            ...(named.via.length > 0 ? { via: named.via } : {}),
          });
        }
      } else if (target.kind === "foreign") {
        imported.add(`foreign:${target.name}`);
        foreign.add(target.name);
        push({
          from,
          to: `foreign:${target.name}`,
          kind: "depends",
          line: reference.line,
        });
      }
    }

    for (const inferred of inference.edgesFor(info)) {
      if (inferred.to !== from && !imported.has(inferred.to)) {
        push({
          from,
          to: inferred.to,
          kind: "depends",
          line: inferred.line,
          names: inferred.names,
          inferred: inferred.inferred,
        });
      }
    }

    for (const heritage of info.heritage) {
      const binding = info.bindings.get(heritage.local);

      if (!binding) {
        continue;
      }

      const target = targetOf(binding.specifier, false);

      if (target.kind !== "project" || target.id === from) {
        continue;
      }

      let toMember: string | null = null;

      if (binding.form === "namespace") {
        toMember = heritage.property;
      } else if (heritage.property === null) {
        toMember =
          binding.form === "default"
            ? (infos.get(target.id)?.defaultName ?? "default")
            : binding.imported;
      }

      if (toMember !== null) {
        push({
          from,
          to: target.id,
          kind: heritage.kind,
          line: heritage.line,
          member: heritage.member,
          to_member: toMember,
        });
      }
    }
  }

  const outlined = new Map(
    [...infos].map(([id, info]) => [
      id,
      info.members.map((m) => ({ ...m, ...m.outline })),
    ]),
  );
  const calls = findCalls({
    program,
    files,
    idOf,
    infos,
    inference,
    members: outlined,
  });

  return {
    schema_version: 5,
    scanner: { name: SCANNER_NAME, version: scannerVersion() },
    commit,
    modified,
    files: files.map((file) => ({
      path: idOf(file),
      hash: createHash("sha256").update(readFileSync(file)).digest("hex"),
    })),
    selection: selection(),
    modules: [...modules].sort(compare).map((id) => {
      const members = infos.get(id)?.members ?? [];

      return {
        id,
        language: "typescript",
        kind: moduleKind(members),
        members: members.map(({ name, kind, line, exported, outline }) => ({
          name,
          kind,
          line,
          exported,
          ...outline,
        })),
      };
    }),
    edges: sortEdges([...edges.values()]),
    foreign: [...foreign]
      .sort((a, b) => compare(`foreign:${a}`, `foreign:${b}`))
      .map((name) => ({ id: `foreign:${name}`, name })),
    calls,
  };
}
