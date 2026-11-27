import { LanguageBehaviour } from "../../domain/analysis/language-behaviour.js";
import { compareUtf8 } from "../../domain/analysis/tests-hash/bytes.js";
import type { Repository } from "../../domain/repository.js";
import {
  type RepositoryFiles,
  SOURCE_LISTING,
} from "../shared/ports/repository-files.js";
import type { Digest } from "./ports/digest.js";
import type { PublishedLanguages } from "./ports/published-languages.js";
import type { SourceFiles } from "./ports/source-files.js";
import type { TestReports } from "./ports/test-reports.js";

export interface TestsHashPorts {
  source: SourceFiles;
  repositoryFiles: RepositoryFiles;
  digest: Digest;
  testReports: TestReports;
  languages: PublishedLanguages;
}

export function currentTestsHash(
  ports: TestsHashPorts,
  root: string,
  repository: Repository,
): string | null {
  return testsHashOf(ports, root, repository.scannedHashes());
}

export function testsHashOf(
  ports: TestsHashPorts,
  root: string,
  known: ReadonlyMap<string, string>,
): string | null {
  const listing = ports.repositoryFiles.list(root, SOURCE_LISTING);

  if (listing.from === "none") {
    return null;
  }

  const listedPaths = [...new Set(listing.paths.filter((path) => path !== ""))];
  const hashes = new Map<string, string>();
  const behaviour = new LanguageBehaviour(ports.languages.rules());

  for (const path of listedPaths.filter((one) => behaviour.isTestFile(one))) {
    const knownHash = known.get(path);
    const hash =
      knownHash !== undefined && knownHash !== ""
        ? knownHash
        : ports.source.hashOf(root, path);

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
