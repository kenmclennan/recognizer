import ts from "typescript";
import { extract } from "./extract.js";
import type { Resolver } from "./resolve.js";
import { namedEdges, type Router } from "./routes.js";

export interface TestImport {
  from: string;
  to: string;
  names?: string[];
}

export interface TestImportInputs {
  testFiles: string[];
  idOf: (file: string) => string;
  compilerOptions: ts.CompilerOptions;
  host: ts.CompilerHost;
  modules: Set<string>;
  resolver: Resolver;
  router: Router;
  optionsFor: (file: string) => ts.CompilerOptions;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function readTestImports(inputs: TestImportInputs): TestImport[] {
  const { testFiles, idOf, modules, resolver, router } = inputs;

  if (testFiles.length === 0) {
    return [];
  }

  const program = ts.createProgram(
    testFiles,
    inputs.compilerOptions,
    inputs.host,
  );
  const records: TestImport[] = [];

  for (const file of testFiles) {
    const source = program.getSourceFile(file);

    if (!source || program.getSyntacticDiagnostics(source).length > 0) {
      continue;
    }

    const from = idOf(file);
    const options = inputs.optionsFor(file);
    const names = new Map<string, Set<string>>();
    const whole = new Set<string>();

    const take = (target: string, taken: readonly string[] | null) => {
      if (!modules.has(target)) {
        return;
      }

      const seen = names.get(target) ?? new Set<string>();
      names.set(target, seen);

      if (taken === null) {
        whole.add(target);
      } else {
        for (const name of taken) {
          seen.add(name);
        }
      }
    };

    for (const reference of extract(source).imports) {
      const target = resolver.resolve(
        reference.specifier,
        file,
        options,
        reference.commonjs,
      );

      if (target.kind !== "project") {
        continue;
      }

      if (reference.names === null) {
        take(target.id, null);

        continue;
      }

      for (const named of namedEdges(
        from,
        target.id,
        reference.names,
        router,
      )) {
        take(named.to, named.names);
      }
    }

    for (const [target, seen] of names) {
      records.push({
        from,
        to: target,
        ...(!whole.has(target) && seen.size > 0
          ? { names: [...seen].sort(compare) }
          : {}),
      });
    }
  }

  return records.sort((a, b) => compare(a.from, b.from) || compare(a.to, b.to));
}
