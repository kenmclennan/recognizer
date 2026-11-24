import { File, Repository } from "../../src/index.js";

export function repositoryInLanguages(
  files: Record<string, string>,
): Repository {
  return Repository.of({
    files: Object.entries(files).map(
      ([path, language]) =>
        new File({
          path,
          language,
          kind: "source",
          hash: "h",
          members: [],
          entryPoint: false,
          annotations: [],
          actualOf: [],
        }),
    ),
  });
}
