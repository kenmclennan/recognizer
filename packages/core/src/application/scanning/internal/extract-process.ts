import type { PhaseRecorder } from "../../../domain/phase-recorder.js";
import { Repository } from "../../../domain/repository.js";
import type { ScanSink } from "../../../domain/scan-sink.js";
import type { PluginLimits } from "../../shared/ports/process.js";
import type { ExtractCall, ExtractResult } from "../ports/scanners.js";
import type { ScanningQueries } from "./scanning-ports.js";

export interface ExtractScansInput {
  root: string;
  force: boolean;
  commit: string | null;
  modified: boolean | null;
  detected: string[];
  limits: PluginLimits;
  sink: ScanSink;
  recorder: PhaseRecorder;
}

export type ExtractOutcome =
  | { stopped: true }
  | { stopped: false; repository: Repository; missing: string[] };

function relativeTo(root: string, file: string): string {
  const prefix = root.endsWith("/") ? root : `${root}/`;

  return file.startsWith(prefix) ? file.slice(prefix.length) : file;
}

export function* extractProcess(
  ports: ScanningQueries,
  input: ExtractScansInput,
): Generator<ExtractCall, ExtractOutcome, ExtractResult> {
  const { scanners, store } = ports;
  const { root, commit, modified, detected, limits, sink, recorder } = input;
  const decision = scanners.decide(
    root,
    input.force,
    commit,
    modified === true,
  );
  const extract = recorder.start("extract");

  sink.emit({
    type: "phase",
    phase: "extract",
    detail: decision.run
      ? {
          state: "run",
          commit,
          reason: decision.reason,
          languages: detected,
        }
      : { state: "current", commit: decision.commit },
  });

  if (!decision.run) {
    sink.human("stdout", `scans current at ${decision.commit}\n`);
  }

  for (const language of scanners.cachedLanguages(root)) {
    if (detected.includes(language)) {
      continue;
    }

    const file = scanners.scanFile(root, language);

    if (store.remove(file)) {
      recorder.removed(file);
      sink.say(
        "stderr",
        `${language}: removed stale ${relativeTo(root, file)}\n`,
      );
    }
  }

  const noted = new Set<string>();

  for (const language of detected) {
    const file = scanners.scanFile(root, language);
    const shown = relativeTo(root, file);

    if (!decision.run) {
      continue;
    }

    const note = scanners.previousProtocolNote(language);

    if (note !== null && !noted.has(note.scanner)) {
      noted.add(note.scanner);
      sink.say("stderr", note.text);
    }

    const scanned = yield {
      root,
      language,
      commit,
      modified,
      limits,
      onEvent: (name, data) => {
        sink.emit({ type: "plugin", phase: "extract", name, data });
      },
      say: sink.say,
    };

    if (sink.stopped) {
      return { stopped: true };
    }

    if (scanned.ok) {
      store.writeScan(root, language, scanned.bytes);
      recorder.entry(
        extract,
        scanned.entry,
        { modules: scanned.modules, edges: scanned.edges },
        shown,
      );

      continue;
    }

    sink.say("stderr", `${language}: ${scanned.reason} - ${scanned.message}\n`);

    if (store.remove(file)) {
      recorder.removed(file);
      sink.say("stderr", `${language}: removed stale ${shown}\n`);
    }

    recorder.entry(extract, scanned.entry);
  }

  const parts: Repository[] = [];
  const missing: string[] = [];

  for (const language of detected) {
    const cached = scanners.readCached(root, language);

    if (cached === null) {
      missing.push(language);
    } else {
      parts.push(cached);
    }
  }

  return { stopped: false, repository: Repository.join(parts), missing };
}
