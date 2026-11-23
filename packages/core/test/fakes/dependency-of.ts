import { Dependency, Repository } from "../../src/index.js";
import { repositoryOf } from "./repository-of.js";

export function edge(
  from: string,
  to: string,
  line = 1,
  kind: Dependency["kind"] = "depends",
): Dependency {
  return new Dependency({
    from,
    to,
    toLibrary: false,
    language: "python",
    kind,
    line,
  });
}

export function repositoryWith(
  paths: string[],
  dependencies: Dependency[],
): Repository {
  const files = Object.fromEntries(paths.map((path) => [path, "h"]));

  const base = repositoryOf(files, []);

  return Repository.of({ ...base, dependencies });
}
