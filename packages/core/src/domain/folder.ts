import { InvalidEntity } from "./invalid-entity.js";

function parentPath(path: string): string | null {
  const at = path.lastIndexOf("/");

  return at === -1 ? null : path.slice(0, at);
}

export class Folder {
  readonly path: string;
  readonly parent: string | null;
  readonly holdsFile: boolean;

  constructor(path: string, parent: string | null, holdsFile = false) {
    if (path === "") {
      throw new InvalidEntity("Folder", "path is empty", path);
    }

    if (path.startsWith("/") || path.endsWith("/")) {
      throw new InvalidEntity(
        "Folder",
        "path has a leading or trailing slash",
        path,
      );
    }

    if (parent !== parentPath(path)) {
      throw new InvalidEntity(
        "Folder",
        "parent is not the path minus its last segment",
        parent,
      );
    }

    this.path = path;
    this.parent = parent;
    this.holdsFile = holdsFile;
  }

  get name(): string {
    return this.path.slice(this.path.lastIndexOf("/") + 1);
  }

  static derive(paths: Iterable<string>): Folder[] {
    const seen = new Map<string, { parent: string | null; holds: boolean }>();

    for (const path of paths) {
      let folder = parentPath(path);
      let direct = true;

      while (folder !== null) {
        const known = seen.get(folder);

        if (known === undefined) {
          seen.set(folder, { parent: parentPath(folder), holds: direct });
        } else if (direct) {
          known.holds = true;
        }

        direct = false;
        folder = parentPath(folder);
      }
    }

    return [...seen].map(
      ([path, { parent, holds }]) => new Folder(path, parent, holds),
    );
  }

  static chainOf(path: string): Folder[] {
    const chain: Folder[] = [];
    let folder = parentPath(path);

    while (folder !== null) {
      chain.unshift(new Folder(folder, parentPath(folder)));
      folder = parentPath(folder);
    }

    return chain;
  }
}
