import type {
  ExtractCall,
  ExtractionDecision,
  ExtractResult,
  RunEntry,
  ScanDocument,
  Scanners,
} from "../../src/index.js";
import { cachePath, type FakeStore } from "./fake-store.js";

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
    private readonly store: FakeStore,
    log: string[],
  ) {
    this.log = log;
  }

  discover(): { installed: number } {
    return { installed: this.languages.size };
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
        !this.store.files.has(cachePath(root, language)) ||
        this.cachedAt.get(language) !== commit
      ) {
        return { run: true, reason: `no-scan:${language}` };
      }
    }

    return { run: false, commit: commit ?? "" };
  }

  cachedLanguages(root: string): string[] {
    const prefix = `${root}/.recognizer/cache/scan.`;

    return [...this.store.files.keys()]
      .filter((path) => path.startsWith(prefix) && path.endsWith(".json"))
      .map((path) => path.slice(prefix.length, -".json".length))
      .sort();
  }

  readCached(root: string, language: string): ScanDocument | null {
    const bytes = this.store.files.get(cachePath(root, language));

    return bytes === undefined
      ? null
      : { files: Array.from({ length: Number(bytes) }, () => null) };
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
      bytes: String(invented.modules),
      modules: invented.modules,
      edges: invented.edges,
    });
  }
}
