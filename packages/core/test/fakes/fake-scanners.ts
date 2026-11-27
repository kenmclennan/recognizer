import type {
  ExtractCall,
  ExtractionDecision,
  ExtractResult,
  InstalledScanner,
  Repository,
  RunEntry,
  Scanners,
} from "../../src/index.js";
import {
  cachePath,
  type FakeStructureRepository,
} from "./fake-structure-repository.js";
import { repositoryOf } from "./repository-of.js";

export interface InventedLanguage {
  modules: number;
  edges: number;
  fails: boolean;
}

function entryFor(language: string, failure: string | null): RunEntry {
  return {
    name: language,
    command: [`${language}-scanner`],
    status: failure === null ? 0 : 1,
    outcome: failure === null ? "ok" : "failed",
    duration_ms: 1,
    stderr: "",
    ...(failure === null ? {} : { reason: failure }),
  };
}

export class FakeScanners implements Scanners {
  readonly languages = new Map<string, InventedLanguage>();
  readonly extracted: string[] = [];
  readonly log: string[];
  readonly cachedAt = new Map<string, string>();

  constructor(
    private readonly structure: FakeStructureRepository,
    log: string[],
  ) {
    this.log = log;
  }

  discover(): { installed: number } {
    return { installed: this.languages.size };
  }

  installedPlugins(): InstalledScanner[] {
    return [...this.languages.keys()].map((language) => ({
      name: language,
      manifest: { languages: [{ name: language }] },
    }));
  }

  detect(): string[] {
    return [...this.languages.keys()];
  }

  decide(
    root: string,
    force: boolean,
    commit: string | null,
  ): ExtractionDecision {
    if (force) {
      return { run: true, reason: "forced" };
    }

    for (const language of this.languages.keys()) {
      if (
        !this.structure.scans.has(cachePath(root, language)) ||
        this.cachedAt.get(language) !== commit
      ) {
        return { run: true, reason: `no-scan:${language}` };
      }
    }

    return { run: false, commit: commit ?? "" };
  }

  cachedLanguages(root: string): string[] {
    const prefix = `${root}/.recognizer/cache/scan.`;

    return [...this.structure.scans.keys()]
      .filter((path) => path.startsWith(prefix) && path.endsWith(".json"))
      .map((path) => path.slice(prefix.length, -".json".length))
      .sort();
  }

  readCached(root: string, language: string): Repository | null {
    return this.structure.scans.get(cachePath(root, language)) ?? null;
  }

  scanFile(root: string, language: string): string {
    return cachePath(root, language);
  }

  previousProtocolNote(): null {
    return null;
  }

  extract(call: ExtractCall): Promise<ExtractResult> {
    this.extracted.push(call.language);
    this.log.push(`extract:${call.language}`);

    const invented = this.languages.get(call.language) as InventedLanguage;

    if (invented.fails) {
      return Promise.resolve({
        ok: false,
        entry: entryFor(call.language, "scanner-failed - exit 1"),
        reason: "scanner-failed",
        message: "exit 1",
      });
    }

    this.cachedAt.set(call.language, call.commit ?? "");

    return Promise.resolve({
      ok: true,
      entry: entryFor(call.language, null),
      repository: repositoryOf(
        Object.fromEntries(
          Array.from({ length: invented.modules }, (_, at) => [`f${at}`, ""]),
        ),
        [],
        call.language,
      ),
      modules: invented.modules,
      edges: invented.edges,
    });
  }
}
