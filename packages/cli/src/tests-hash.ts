import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Io } from "./cli.js";
import { isTestFile } from "./entry-points.js";
import {
  buildFreshness,
  type Freshness,
  type Measured,
  scanHashes,
} from "./result-freshness.js";
import { inFileTestHashes } from "./rust-test-blocks.js";
import type { Scan } from "./scan.js";

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function currentTestsHash(
  io: Io,
  root: string,
  scans: readonly Scan[],
): string | null {
  const listed = io.run("git", [
    "-C",
    root,
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    ".",
    ":!.recognizer",
  ]);

  if (!listed.started || listed.status !== 0) {
    return null;
  }

  const known = scanHashes(scans);
  const listedPaths = [
    ...new Set(listed.stdout.split("\0").filter((path) => path !== "")),
  ];
  const hashes = new Map<string, string>();

  for (const path of listedPaths.filter(isTestFile)) {
    const hash = known.get(path) ?? io.hashFile(join(root, path));

    if (hash !== null && hash !== undefined) {
      hashes.set(path, hash);
    }
  }

  for (const [key, hash] of inFileTestHashes(io, root, listedPaths)) {
    hashes.set(key, hash);
  }

  const lines = [...hashes.keys()]
    .sort(compareUtf8)
    .map((key) => `${key}\t${hashes.get(key)}\n`);

  return createHash("sha256").update(lines.join("")).digest("hex");
}

export function freshnessFor(
  io: Io,
  root: string,
  scans: readonly Scan[],
): (measured: Measured) => Freshness {
  let tests: string | null | undefined;

  return (measured) => {
    if (measured.tests !== undefined && tests === undefined) {
      tests = currentTestsHash(io, root, scans);
    }

    return buildFreshness(scans, tests ?? null);
  };
}
