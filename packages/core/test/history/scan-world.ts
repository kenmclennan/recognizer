import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  adoptScanBaseline,
  compareScanBaseline,
  type ExtractionSelection,
  Limiter,
  type RecordedScan,
  type ScanBaseline,
  type ScanChanges,
  ScanSelection,
  takeScanOrigin,
  WindowBaselines,
} from "../../src/index.js";
import { FakeGit } from "../fakes/fake-git.js";
import { FakeRecordedScans } from "../fakes/fake-recorded-scans.js";
import { FakeRepositoryFiles } from "../fakes/fake-repository-files.js";
import { FakeSetupFiles } from "../fakes/fake-setup-files.js";
import { FakeWorkTree, sha256 } from "../fakes/fake-work-tree.js";

export const ROOT = "/work/repository";
export const WINDOW = "w-1";

const fixtures = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../fixtures",
);

type Json = Record<string, unknown>;

export function expectedScan(language: string): Json {
  return JSON.parse(
    readFileSync(join(fixtures, language, "expected-scan.json"), "utf8"),
  ) as Json;
}

export function selectionFrom(raw: Json): ExtractionSelection {
  const list = (key: string): string[] | undefined =>
    raw[key] as string[] | undefined;
  const optional = (name: string, key: string) =>
    list(key) === undefined ? {} : { [name]: list(key) };

  return {
    extensions: list("extensions") ?? [],
    skipDirectoryNames: list("skip_directory_names") ?? [],
    skipDirectoryPrefixes: list("skip_directory_prefixes") ?? [],
    skipDirectorySuffixes: list("skip_directory_suffixes") ?? [],
    skipDirectoriesContaining: list("skip_directories_containing") ?? [],
    skipFileGlobs: list("skip_file_globs") ?? [],
    ...optional("skipPaths", "skip_paths"),
    ...optional("inputFileGlobs", "input_file_globs"),
    ...optional("inputAbsentPaths", "input_absent_paths"),
  };
}

export function selectionOf(language: string): ExtractionSelection {
  return selectionFrom(expectedScan(language).selection as Json);
}

function filesUnder(directory: string, prefix = ""): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;

    return entry.isDirectory()
      ? filesUnder(join(directory, entry.name), relative)
      : [relative];
  });
}

export class ScanWorld {
  readonly git = new FakeGit("abcdef0123456789abcdef0123456789abcdef01");
  readonly tree = new FakeWorkTree();
  readonly repositoryFiles = new FakeRepositoryFiles(new FakeSetupFiles());
  readonly scans = new FakeRecordedScans();
  readonly windows = new WindowBaselines();
  readonly ports = {
    git: this.git,
    files: this.repositoryFiles,
    recordedScans: this.scans,
    workTree: this.tree,
    limiter: new Limiter(4),
  };

  constructor() {
    this.git.branchName = "main";
  }

  write(path: string, text: string): void {
    this.tree.write(path, text);
  }

  remove(path: string): void {
    this.tree.remove(path);
  }

  copyFixture(language: string): void {
    const sample = join(fixtures, language, "sample");

    for (const path of filesUnder(sample)) {
      this.write(path, readFileSync(join(sample, path), "utf8"));
    }
  }

  recordScan(language: string, files?: RecordedScan["files"]): void {
    const selection = new ScanSelection(selectionOf(language));
    const paths = [...this.tree.files.keys()].sort();
    const present = new Set(paths);

    this.scans.scans = [
      ...this.scans.scans,
      {
        selection: selectionOf(language),
        files:
          files ??
          paths
            .filter((path) => selection.accepts(path, present))
            .map((path) => ({
              path,
              hash: sha256(this.tree.files.get(path) as string),
            })),
      },
    ];
  }

  useCommittedScan(language: string): void {
    const scan = expectedScan(language);

    this.scans.scans = [
      ...this.scans.scans,
      {
        selection: selectionOf(language),
        files: scan.files as RecordedScan["files"],
      },
    ];
  }

  adopt(): ScanBaseline {
    takeScanOrigin(this.ports, this.windows, WINDOW, ROOT);
    adoptScanBaseline(this.ports, this.windows, WINDOW, ROOT);

    return this.baseline();
  }

  baseline(): ScanBaseline {
    return this.windows.peek(WINDOW)?.baseline as ScanBaseline;
  }

  refresh(): void {
    this.repositoryFiles.listed = [...this.tree.files.keys()].sort();
  }

  async compare(baseline = this.baseline()): Promise<ScanChanges> {
    this.refresh();

    return compareScanBaseline(this.ports, baseline, ROOT);
  }

  async listed(baseline = this.baseline()) {
    const changes = await this.compare(baseline);

    return changes.files.map((change) => [change.path, change.kind]);
  }
}

export function pythonRepository(): ScanWorld {
  const world = new ScanWorld();

  world.write("app/a.py", "a = 1\n");
  world.write("app/b.py", "b = 1\n");
  world.write("web/c.ts", "export const c = 1;\n");

  return world;
}

export function baselineOf(
  world: ScanWorld,
  languages: string[],
): ScanBaseline {
  takeScanOrigin(world.ports, world.windows, WINDOW, ROOT);

  for (const language of languages) {
    world.recordScan(language);
  }

  adoptScanBaseline(world.ports, world.windows, WINDOW, ROOT);

  return world.baseline();
}

export function pythonWith(world: ScanWorld, extra: Json): ScanBaseline {
  const selection = selectionFrom({
    extensions: [".py"],
    skip_directory_names: ["node_modules"],
    skip_directory_prefixes: ["."],
    skip_directory_suffixes: [],
    skip_directories_containing: [],
    skip_file_globs: [],
    ...extra,
  });

  takeScanOrigin(world.ports, world.windows, WINDOW, ROOT);
  world.scans.scans = [{ files: [], selection }];
  adoptScanBaseline(world.ports, world.windows, WINDOW, ROOT);

  return world.baseline();
}
