import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  adoptScanBaseline,
  compareScanBaseline,
  Limiter,
  ScanBaseline,
  type ScanChanges,
  scanCandidates,
  takeScanOrigin,
  WindowBaselines,
} from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { RecordedScansAdapter } from "../src/adapters/filesystem/recorded-scans-adapter.js";
import type { DocumentSelection } from "../src/adapters/filesystem/scan-document-types.js";
import { selectionOf } from "../src/adapters/filesystem/scan-translator.js";
import { WorkTreeAdapter } from "../src/adapters/filesystem/work-tree-adapter.js";
import { GitAdapter } from "../src/adapters/git/git-adapter.js";
import { nodeIo } from "../src/cli.js";

const fixtures = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures",
);
const WINDOW = "w-1";

interface Json {
  selection: DocumentSelection & Record<string, unknown>;
  files: unknown[];
  [key: string]: unknown;
}

interface Parity {
  [language: string]: { tree: string[]; accepted: string[] };
}

const ports = {
  git: new GitAdapter(nodeIo()),
  recordedScans: new RecordedScansAdapter(),
  workTree: new WorkTreeAdapter(),
  limiter: new Limiter(4),
};

function git(dir: string, ...args: string[]): void {
  const result = spawnSync(
    "git",
    [
      "-C",
      dir,
      "-c",
      "user.email=t@example.com",
      "-c",
      "user.name=t",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { encoding: "utf8" },
  );

  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
}

function write(dir: string, relative: string, text: string): void {
  const path = join(dir, relative);

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function repo(): string {
  const dir = makeTempDir("recognizer-baseline-");

  git(dir, "init", "-q", "-b", "main");
  write(dir, "app/a.py", "a = 1\n");
  write(dir, "app/b.py", "b = 1\n");
  write(dir, "web/c.ts", "export const c = 1;\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "first");

  return dir;
}

function expectedScan(language: string): Json {
  return JSON.parse(
    readFileSync(join(fixtures, language, "expected-scan.json"), "utf8"),
  ) as Json;
}

async function recordScan(dir: string, language: string): Promise<void> {
  const scan = expectedScan(language);
  const empty = new ScanBaseline(
    [{ files: [], selection: selectionOf(scan.selection) }],
    { branch: null, commit: null },
  );
  const paths = await scanCandidates(ports, empty, dir);
  const files = await Promise.all(
    paths.map(async (path) => ({
      path,
      hash: (await ports.workTree.hash(dir, path)) as string,
    })),
  );

  write(
    dir,
    `.recognizer/cache/scan.${language}.json`,
    JSON.stringify({ ...scan, files }),
  );
}

function adopted(
  withPorts: typeof ports,
  windows: WindowBaselines,
  dir: string,
): ScanBaseline {
  adoptScanBaseline(withPorts, windows, WINDOW, dir);

  return windows.peek(WINDOW)?.baseline as ScanBaseline;
}

function adopt(
  dir: string,
  origin = new WindowBaselines(),
): [ScanBaseline, WindowBaselines] {
  takeScanOrigin(ports, origin, WINDOW, dir);

  return [adopted(ports, origin, dir), origin];
}

async function baselineOf(dir: string, languages: string[]) {
  const windows = new WindowBaselines();

  takeScanOrigin(ports, windows, WINDOW, dir);

  for (const language of languages) {
    await recordScan(dir, language);
  }

  return adopted(ports, windows, dir);
}

function listed(changes: ScanChanges): [string, string][] {
  return changes.files.map((change) => [change.path, change.kind]);
}

function compare(dir: string, baseline: ScanBaseline): Promise<ScanChanges> {
  return compareScanBaseline(ports, baseline, dir);
}

function copyFixture(language: string, dir: string): void {
  cpSync(join(fixtures, language, "sample"), dir, { recursive: true });
  write(
    dir,
    `.recognizer/cache/scan.${language}.json`,
    JSON.stringify(expectedScan(language)),
  );
}

function filesBelow(directory: string, prefix = ""): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;

    return entry.isDirectory()
      ? filesBelow(join(directory, entry.name), relative)
      : [relative];
  });
}

describe("ScanBaseline over a real git repository", () => {
  it("the committed typescript scan lists the manifests it read", async () => {
    const dir = makeTempDir("recognizer-baseline-");

    copyFixture("typescript", dir);
    git(dir, "init", "-q", "-b", "main");

    const [baseline] = adopt(dir);

    expect((await compare(dir, baseline)).files).toEqual([]);
  });

  it("a new commit counts as moved", async () => {
    const dir = repo();
    const baseline = await baselineOf(dir, ["python"]);

    git(dir, "commit", "-q", "--allow-empty", "-m", "next");

    const changes = await compare(dir, baseline);

    expect(changes.moved?.branch).toBe("main");
    expect(changes.moved?.commit).toHaveLength(7);
    expect(changes.files).toEqual([]);
  });

  it("a branch switch at the same commit counts as moved", async () => {
    const dir = repo();
    const baseline = await baselineOf(dir, ["python"]);

    git(dir, "checkout", "-q", "-b", "other");

    expect((await compare(dir, baseline)).moved?.branch).toBe("other");
  });

  it("an unmoved head is not moved", async () => {
    const dir = repo();
    const baseline = await baselineOf(dir, ["python"]);

    expect(await compare(dir, baseline)).toEqual({ files: [], moved: null });
  });

  it("a gitignored new file does not count", async () => {
    const dir = repo();

    write(dir, ".gitignore", "ignored/\n");

    const baseline = await baselineOf(dir, ["python"]);

    write(dir, "ignored/x.py", "x = 1\n");

    expect((await compare(dir, baseline)).files).toEqual([]);
  });

  it("a tracked file that a gitignore pattern matches counts", async () => {
    const dir = repo();

    write(dir, "kept/x.py", "x = 1\n");
    git(dir, "add", "-f", "kept/x.py");
    write(dir, ".gitignore", "kept/\n");

    const baseline = await baselineOf(dir, ["python"]);

    write(dir, "kept/x.py", "x = 2\n");

    expect(listed(await compare(dir, baseline))).toEqual([
      ["kept/x.py", "modified"],
    ]);
  });

  it("outside git there is no commit and changes are still reported", async () => {
    const dir = makeTempDir("recognizer-baseline-");

    write(dir, "app/a.py", "a = 1\n");
    write(dir, "app/b.py", "b = 1\n");

    const baseline = await baselineOf(dir, ["python"]);

    expect(baseline.shortOrigin()).toEqual({ branch: null, commit: null });

    write(dir, "app/a.py", "a = 2\n");
    write(dir, "app/c.py", "c = 1\n");

    const changes = await compare(dir, baseline);

    expect(changes.moved).toBeNull();
    expect(changes.files).toHaveLength(2);
  });

  it("an edit made between the scan and adoption is reported", async () => {
    const dir = repo();
    const windows = new WindowBaselines();

    takeScanOrigin(ports, windows, WINDOW, dir);
    await recordScan(dir, "python");
    write(dir, "app/a.py", "a = 2\n");

    const baseline = adopted(ports, windows, dir);

    expect(listed(await compare(dir, baseline))).toEqual([
      ["app/a.py", "modified"],
    ]);
  });
});

async function assertCleanBaseline(language: string, count: number) {
  const scan = expectedScan(language);

  expect(scan.files).toHaveLength(count);

  const dir = makeTempDir("recognizer-baseline-");

  copyFixture(language, dir);

  const [baseline] = adopt(dir);

  expect(baseline.hashes.size).toBe(count);
  expect(await compare(dir, baseline)).toEqual({ files: [], moved: null });
}

describe("ScanBaseline over the committed fixtures", () => {
  it("the python fixture scan compares clean against its own files", async () => {
    await assertCleanBaseline("python", 15);
  });

  it("the typescript fixture scan compares clean against its own files", async () => {
    await assertCleanBaseline("typescript", 20);
  });

  it("the kotlin fixture scan compares clean against its own files", async () => {
    await assertCleanBaseline("kotlin", 11);
  });

  it("the rust fixture scan compares clean against its own files", async () => {
    await assertCleanBaseline("rust", 10);
  });

  it("the csharp fixture scan compares clean against its own files", async () => {
    const skipped = expectedScan("csharp").selection.skip_paths as string[];

    expect(skipped).toHaveLength(6);

    for (const directory of skipped) {
      expect(
        existsSync(join(fixtures, "csharp", "sample", directory, "Check.cs")),
      ).toBe(true);
    }

    await assertCleanBaseline("csharp", 36);
  });

  const parity = JSON.parse(
    readFileSync(join(fixtures, "selection-parity.json"), "utf8"),
  ) as Parity;

  async function assertParity(language: string) {
    const dir = makeTempDir("recognizer-parity-");

    for (const path of parity[language]?.tree ?? []) {
      write(dir, path, "");
    }

    write(
      dir,
      `.recognizer/cache/scan.${language}.json`,
      JSON.stringify({ ...expectedScan(language), files: [] }),
    );

    const [baseline] = adopt(dir);
    const accepted = await scanCandidates(ports, baseline, dir);

    expect([...accepted].sort()).toEqual(parity[language]?.accepted);
  }

  it("the python selection accepts exactly the files the python scanner reads", async () => {
    await assertParity("python");
  });

  it("the typescript selection accepts exactly the files the typescript scanner reads", async () => {
    await assertParity("typescript");
  });

  it("the kotlin selection accepts exactly the files the kotlin scanner reads", async () => {
    await assertParity("kotlin");
  });

  it("the rust selection accepts exactly the files the rust scanner reads", async () => {
    await assertParity("rust");
  });

  it("the csharp selection accepts exactly the files the csharp scanner reads", async () => {
    await assertParity("csharp");
  });
});

describe("RecordedScansAdapter", () => {
  it("a scan that cannot be read contributes nothing", () => {
    const dir = makeTempDir("recognizer-baseline-");

    write(dir, ".recognizer/cache/scan.python.json", "{}");

    expect(new RecordedScansAdapter().read(dir)).toEqual([]);
  });

  it("holds the hashes and the selection a scan recorded", () => {
    const dir = makeTempDir("recognizer-baseline-");

    write(
      dir,
      ".recognizer/cache/scan.python.json",
      JSON.stringify({ ...expectedScan("python"), files: [] }),
    );

    const [scan] = new RecordedScansAdapter().read(dir);

    expect(scan?.selection.extensions).toContain(".py");
    expect(filesBelow(dir)).toEqual([".recognizer/cache/scan.python.json"]);
  });
});
