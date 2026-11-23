import type {
  ResponsibilityKinds,
  StructureRepository,
} from "../../src/index.js";
import { Repository } from "../../src/index.js";

export function cachePath(root: string, language: string): string {
  return `${root}/.recognizer/cache/scan.${language}.json`;
}

export class FakeStructureRepository implements StructureRepository {
  readonly scans = new Map<string, Repository>();
  readonly kinds = new Map<string, ResponsibilityKinds>();

  exists(): boolean {
    return true;
  }

  read(root: string): Repository {
    const prefix = `${root}/.recognizer/cache/scan.`;

    return Repository.join(
      [...this.scans.keys()]
        .filter((path) => path.startsWith(prefix))
        .sort()
        .flatMap((path) => this.scans.get(path) ?? []),
    );
  }

  save(root: string, language: string, scanned: Repository): void {
    this.scans.set(cachePath(root, language), scanned);
  }

  discard(root: string, language: string): boolean {
    return this.scans.delete(cachePath(root, language));
  }

  responsibilityKinds(root: string): ResponsibilityKinds {
    return this.kinds.get(root) ?? { registered: false, kinds: {} };
  }
}
