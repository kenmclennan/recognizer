import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Repository } from "@recognizer/core";
import { isTestFile } from "@recognizer/core";
import type { Io } from "./cli.js";
import { inFileTestHashes } from "./rust-test-blocks.js";

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function currentTestsHash(
  io: Io,
  root: string,
  repository: Repository,
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

  const known = repository.scannedHashes();
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
