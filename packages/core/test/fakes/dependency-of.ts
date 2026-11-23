import type { Dependency, Repository } from "../../src/index.js";
import { repositoryOf } from "./repository-of.js";

export function edge(
  from: string,
  to: string,
  line = 1,
  kind: Dependency["kind"] = "depends",
): Dependency {
  return { from, to, toLibrary: false, language: "python", kind, line };
}

export function repositoryWith(
  paths: string[],
  dependencies: Dependency[],
): Repository {
  const files = Object.fromEntries(paths.map((path) => [path, "h"]));

  return { ...repositoryOf(files, []), dependencies };
}
