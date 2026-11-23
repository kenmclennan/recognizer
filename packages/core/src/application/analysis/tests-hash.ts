import { isTestFile } from "../../domain/analysis/entry-points.js";
import {
  compareUtf8,
  indexOfBytes,
} from "../../domain/analysis/tests-hash/bytes.js";
import {
  manifestRoots,
  type Roots,
  resolvedDeclaration,
} from "../../domain/analysis/tests-hash/rust-roots.js";
import {
  type Scanned,
  scan,
} from "../../domain/analysis/tests-hash/rust-scan.js";
import type { Repository } from "../../domain/repository.js";
import type { Digest } from "./ports/digest.js";
import type { SourceFiles } from "./ports/source-files.js";
import type { Toml } from "./ports/toml.js";

export interface TestsHashPorts {
  source: SourceFiles;
  digest: Digest;
  toml: Toml;
}

type First = Map<string, { data: Uint8Array; scanned: Scanned }>;

const TEST = [0x74, 0x65, 0x73, 0x74];

function readOrNull(
  source: SourceFiles,
  root: string,
  path: string,
): Uint8Array | null {
  try {
    return source.readBytes(root, path);
  } catch {
    return null;
  }
}

function firstPass(
  ports: TestsHashPorts,
  root: string,
  sources: readonly string[],
): First {
  const found: First = new Map();

  for (const path of sources) {
    if (isTestFile(path)) {
      continue;
    }

    const data = readOrNull(ports.source, root, path);

    if (data === null || indexOfBytes(data, TEST, 0) < 0) {
      continue;
    }

    found.set(path, { data, scanned: scan(data) });
  }

  return found;
}

function testFileSet(
  ports: TestsHashPorts,
  root: string,
  sources: readonly string[],
  first: First,
  roots: Roots,
): Set<string> {
  const index = new Set(sources);
  const marked = new Set<string>();
  const pending: string[] = [];
  const mark = (path: string | null): void => {
    if (path !== null && !marked.has(path)) {
      marked.add(path);
      pending.push(path);
    }
  };

  for (const [path, { scanned }] of first) {
    if (scanned.fileLevel) {
      mark(path);
    }

    for (const declaration of scanned.declarations) {
      if (declaration.isTest) {
        mark(resolvedDeclaration(path, declaration, index, roots));
      }
    }
  }

  while (pending.length > 0) {
    const file = pending.pop() as string;
    let declarations = first.get(file)?.scanned.declarations;

    if (declarations === undefined) {
      const data = readOrNull(ports.source, root, file);

      declarations = data === null ? [] : scan(data).declarations;
    }

    for (const declaration of declarations) {
      mark(resolvedDeclaration(file, declaration, index, roots));
    }
  }

  return marked;
}

function rootsOf(
  ports: TestsHashPorts,
  root: string,
  paths: readonly string[],
): Roots {
  return manifestRoots(
    paths,
    (path) => ports.source.readText(root, path),
    (text) => ports.toml.parse(text),
  );
}

function rustSources(paths: readonly string[]): string[] {
  return [...new Set(paths.filter((path) => path.endsWith(".rs")))].sort();
}

export function rustTestFiles(
  ports: TestsHashPorts,
  root: string,
  paths: readonly string[],
): Set<string> {
  const sources = rustSources(paths);

  return testFileSet(
    ports,
    root,
    sources,
    firstPass(ports, root, sources),
    rootsOf(ports, root, paths),
  );
}

export function inFileTestHashes(
  ports: TestsHashPorts,
  root: string,
  paths: readonly string[],
): Map<string, string> {
  const sources = rustSources(paths);
  const first = firstPass(ports, root, sources);
  const entries = new Map<string, string>();

  for (const [path, { data, scanned }] of first) {
    scanned.items.forEach(([start, stop], number) => {
      entries.set(
        `${path}#${number}`,
        ports.digest.sha256(data.subarray(start, stop)),
      );
    });
  }

  for (const path of [
    ...testFileSet(ports, root, sources, first, rootsOf(ports, root, paths)),
  ].sort()) {
    const data = readOrNull(ports.source, root, path);

    if (data !== null) {
      entries.set(`${path}#file`, ports.digest.sha256(data));
    }
  }

  return entries;
}

export function currentTestsHash(
  ports: TestsHashPorts,
  root: string,
  repository: Repository,
): string | null {
  const listed = ports.source.listFiles(root);

  if (listed === null) {
    return null;
  }

  const known = repository.scannedHashes();
  const listedPaths = [...new Set(listed.filter((path) => path !== ""))];
  const hashes = new Map<string, string>();

  for (const path of listedPaths.filter(isTestFile)) {
    const hash = known.get(path) ?? ports.source.hashOf(root, path);

    if (hash !== null && hash !== undefined) {
      hashes.set(path, hash);
    }
  }

  for (const [key, hash] of inFileTestHashes(ports, root, listedPaths)) {
    hashes.set(key, hash);
  }

  const lines = [...hashes.keys()]
    .sort(compareUtf8)
    .map((key) => `${key}\t${hashes.get(key)}\n`);

  return ports.digest.sha256(lines.join(""));
}
