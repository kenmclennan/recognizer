import {
  EMPTY_REPOSITORY,
  type File,
  joinRepositories,
  type Repository,
} from "@recognizer/core";

export function unionScans(
  head: Repository,
  base: Repository | null,
  removed: readonly string[],
): Repository {
  if (base === null || removed.length === 0) {
    return head;
  }

  const gone = new Set(removed);
  const present = new Set(head.files.map((file) => file.path));
  const modules = new Map<string, File>();

  for (const file of base.files) {
    if (gone.has(file.path) && !present.has(file.path)) {
      modules.set(file.path, file);
    }
  }

  if (modules.size === 0) {
    return head;
  }

  const inUnion = (id: string) => present.has(id) || modules.has(id);
  const dependencies = base.dependencies.filter(
    (edge) =>
      (modules.has(edge.from) || modules.has(edge.to)) &&
      inUnion(edge.from) &&
      inUnion(edge.to),
  );

  return joinRepositories([
    head,
    { ...EMPTY_REPOSITORY, files: [...modules.values()], dependencies },
  ]);
}
