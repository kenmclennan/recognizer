import {
  type DocumentFreshness,
  documentFreshness,
  type Finding,
  type FindingsRepository,
  Repository,
  type RepositoryState,
  reportedMs,
  type SensorFindingsHeader,
  type SuiteStanding,
  scanHistory,
  splitDocument,
  suiteStandings,
} from "@recognizer/core";
import type { Io } from "../cli.js";
import { readOverlayText } from "../document-text.js";
import { readStoredFindings, readStoredOverlays } from "../findings-files.js";
import type { Overlay } from "../overlays.js";
import {
  type Refusal,
  readRunRecordFiles,
  refusalsOf,
  registeredNames,
} from "./refusals.js";

export interface PluginResults {
  findings: SensorFindingsHeader | null;
  overlay: Overlay | null;
  findingsProblem: string | null;
  overlayProblem: string | null;
  modifiedMs: number | null;
  freshness: DocumentFreshness | null;
  shown: Finding[] | null;
  hidden: Finding[] | null;
  suites: SuiteStanding[] | null;
}

export interface ResultsAnswer {
  revision: number;
  plugins: Record<string, PluginResults>;
  refusals: Record<string, Refusal>;
  lastRun: string | null;
}

export function readPluginResults(
  io: Io,
  root: string,
  state: RepositoryState,
  structure: Repository = Repository.empty,
  tests: string | null = null,
): ResultsAnswer {
  const plugins: Record<string, PluginResults> = {};
  const entry = (name: string): PluginResults => {
    plugins[name] ??= {
      findings: null,
      overlay: null,
      findingsProblem: null,
      overlayProblem: null,
      modifiedMs: reportedMs(state, name),
      freshness: null,
      shown: null,
      hidden: null,
      suites: null,
    };

    return plugins[name] as PluginResults;
  };

  for (const one of readStoredFindings(io, root)) {
    const held = entry(one.name);

    if (one.status === "invalid") {
      held.findingsProblem = one.reason;
    } else {
      const { findings: _records, suites: _suites, ...header } = one.document;

      held.findings = header;

      held.freshness = documentFreshness(
        structure,
        {
          ...(one.document.inputs === undefined
            ? {}
            : { inputs: one.document.inputs }),
          ...(one.document.tests === undefined
            ? {}
            : { tests: one.document.tests }),
        },
        tests,
      );

      const split = splitDocument(structure, one.document, tests);

      held.shown = split.shown;
      held.hidden = split.hidden;
      held.suites = suiteStandings(one.document.suites);
    }
  }

  for (const one of readStoredOverlays(io, root)) {
    const held = entry(one.name);

    if (one.status === "invalid") {
      held.overlayProblem = one.reason;

      continue;
    }

    try {
      held.overlay = readOverlayText(one.text);
    } catch (error) {
      held.overlayProblem = (error as Error).message;
    }
  }

  const records = readRunRecordFiles(io, root);

  return {
    revision: state.revision,
    plugins,
    refusals: refusalsOf(
      records.map(({ record }) => record),
      registeredNames(io, root),
      (name) => reportedMs(state, name),
    ),
    lastRun: scanHistory(records).lastRun,
  };
}

const PLUGIN_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function clearPlugin(
  findings: FindingsRepository,
  root: string,
  plugin: string,
): void {
  if (!PLUGIN_NAME.test(plugin)) {
    throw new Error(`${plugin} is not a plugin name`);
  }

  findings.remove(root, plugin);
}
