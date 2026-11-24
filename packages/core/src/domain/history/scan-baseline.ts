import type { ExtractionSelection } from "../extraction.js";
import { ScanSelection } from "./scan-selection.js";

const COMMIT_LENGTH = 7;

export interface ScanRecord {
  readonly files: readonly { readonly path: string; readonly hash: string }[];
  readonly selection: ExtractionSelection;
}

export type ScanChangeKind = "modified" | "added" | "deleted";

export interface ScanFileChange {
  readonly path: string;
  readonly kind: ScanChangeKind;
}

export interface ScanMoved {
  readonly branch: string | null;
  readonly commit: string;
}

export interface ScanChanges {
  readonly files: readonly ScanFileChange[];
  readonly moved: ScanMoved | null;
}

export interface ScanOrigin {
  readonly branch: string | null;
  readonly commit: string | null;
}

export interface ScanHead {
  readonly branch: string | null;
  readonly commit: string | null;
}

export interface ScanFacts {
  readonly missing: ReadonlySet<string>;
  readonly modified: ReadonlySet<string>;
  readonly listing: readonly string[];
  readonly present: ReadonlySet<string>;
  readonly appearing: ReadonlySet<string>;
  readonly head: ScanHead;
}

export const NO_CHANGES: ScanChanges = { files: [], moved: null };

export function shortCommit(commit: string): string {
  return commit.slice(0, COMMIT_LENGTH);
}

export function sameChanges(a: ScanChanges, b: ScanChanges): boolean {
  return (
    a.files.length === b.files.length &&
    a.files.every(
      (file, at) =>
        file.path === b.files[at]?.path && file.kind === b.files[at]?.kind,
    ) &&
    a.moved?.branch === b.moved?.branch &&
    a.moved?.commit === b.moved?.commit &&
    (a.moved === null) === (b.moved === null)
  );
}

export class ScanBaseline {
  readonly hashes: ReadonlyMap<string, string>;
  readonly selections: readonly ScanSelection[];
  private readonly verified = new Map<string, string>();

  constructor(
    scans: readonly ScanRecord[],
    readonly origin: ScanOrigin,
  ) {
    const hashes = new Map<string, string>();

    for (const scan of scans) {
      for (const file of scan.files) {
        hashes.set(file.path, file.hash);
      }
    }

    this.hashes = hashes;
    this.selections = scans.map((scan) => new ScanSelection(scan.selection));
  }

  get verifiedCount(): number {
    return this.verified.size;
  }

  isVerified(path: string, stamp: string): boolean {
    return this.verified.get(path) === stamp;
  }

  verify(path: string, stamp: string): void {
    this.verified.set(path, stamp);
  }

  shortOrigin(): ScanOrigin {
    return {
      branch: this.origin.branch,
      commit:
        this.origin.commit === null ? null : shortCommit(this.origin.commit),
    };
  }

  descends(directory: string, present: ReadonlySet<string>): boolean {
    return this.selections.some(
      (selection) => !selection.skipsDirectory(directory, present),
    );
  }

  markersAlong(paths: Iterable<string>): string[] {
    const list = [...paths];

    return [
      ...new Set(this.selections.flatMap((one) => one.markersAlong(list))),
    ];
  }

  covers(relative: string, present: ReadonlySet<string>): boolean {
    return this.selections.some((selection) =>
      selection.accepts(relative, present),
    );
  }

  absentPaths(): string[] {
    return this.selections.flatMap(
      (selection) => selection.selection.inputAbsentPaths ?? [],
    );
  }

  readsInputs(): boolean {
    return this.selections.some((selection) => selection.readsInputs());
  }

  candidates(
    listing: readonly string[],
    present: ReadonlySet<string>,
  ): string[] {
    return listing.filter((path) => this.covers(path, present));
  }

  inputsAdded(facts: Pick<ScanFacts, "listing" | "present" | "appearing">) {
    const found: string[] = [];

    if (this.readsInputs()) {
      found.push(
        ...facts.listing.filter(
          (path) =>
            !this.hashes.has(path) &&
            this.selections.some((selection) =>
              selection.readsByName(path, facts.present),
            ),
        ),
      );
    }

    for (const path of this.absentPaths()) {
      if (!this.hashes.has(path) && facts.appearing.has(path)) {
        found.push(path);
      }
    }

    return found;
  }

  moved(head: ScanHead): ScanMoved | null {
    const before = this.origin.commit;

    if (before === null || head.commit === null) {
      return null;
    }

    return head.commit !== before || head.branch !== this.origin.branch
      ? { branch: head.branch, commit: shortCommit(head.commit) }
      : null;
  }

  compare(facts: ScanFacts): ScanChanges {
    const files = new Map<string, ScanChangeKind>();

    for (const path of this.hashes.keys()) {
      if (facts.missing.has(path)) {
        files.set(path, "deleted");
      } else if (facts.modified.has(path)) {
        files.set(path, "modified");
      }
    }

    for (const path of this.candidates(facts.listing, facts.present)) {
      if (!this.hashes.has(path)) {
        files.set(path, "added");
      }
    }

    for (const path of this.inputsAdded(facts)) {
      if (!files.has(path)) {
        files.set(path, "added");
      }
    }

    return {
      files: [...files.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([path, kind]) => ({ path, kind })),
      moved: this.moved(facts.head),
    };
  }
}
