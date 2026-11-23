import { isTestFile } from "../../domain/analysis/entry-points.js";
import { compareUtf8 } from "../../domain/analysis/tests-hash/bytes.js";
import type { Repository } from "../../domain/repository.js";
import type { Digest } from "./ports/digest.js";
import type { SourceFiles } from "./ports/source-files.js";
import type { TestReports } from "./ports/test-reports.js";

export interface TestsHashPorts {
  source: SourceFiles;
  digest: Digest;
  testReports: TestReports;
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

  const reported = ports.testReports.entries(root);

  if (reported === null) {
    return null;
  }

  for (const [key, hash] of reported) {
    hashes.set(key, hash);
  }

  const lines = [...hashes.keys()]
    .sort(compareUtf8)
    .map((key) => `${key}\t${hashes.get(key)}\n`);

  return ports.digest.sha256(lines.join(""));
}
