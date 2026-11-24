import { Dependency, File, Repository } from "../../src/index.js";

interface ScanFixture {
  modules: { id: string; language: string }[];
  edges: { from: string; to: string; line: number }[];
}

export function repositoryFromScan(document: ScanFixture): Repository {
  const known = new Set(document.modules.map((module) => module.id));
  const languageOf = new Map(
    document.modules.map((module) => [module.id, module.language]),
  );

  return Repository.of({
    files: document.modules.map(
      (module) =>
        new File({
          path: module.id,
          language: module.language,
          kind: "source",
          hash: null,
          members: [],
          entryPoint: false,
          annotations: [],
          actualOf: [],
        }),
    ),
    dependencies: document.edges
      .filter((edge) => known.has(edge.to))
      .map(
        (edge) =>
          new Dependency({
            from: edge.from,
            to: edge.to,
            toLibrary: false,
            language: languageOf.get(edge.from) as string,
            kind: "depends",
            line: edge.line,
          }),
      ),
  });
}
