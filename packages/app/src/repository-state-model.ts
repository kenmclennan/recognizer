import type {
  FreshnessView,
  PluginRunView,
  RepositoryState,
  RunView,
} from "@recognizer/core";
import { workingResult } from "@recognizer/core";
import type { ResultDocuments } from "./repository-state-port";
import type {
  FindingsFiles,
  InstalledMetric,
  InstalledSensor,
  InstalledSensors,
  InstalledSetting,
  OverlayFiles,
  StoredResults,
} from "./sensor-run";

export type HeldRevision = {
  stream: string;
  state: RepositoryState;
};

export type SensorRowStatus = "ran" | "failed" | "off" | "stale" | "not run";

export type SensorRow = {
  name: string;
  display: string;
  registered: boolean;
  reason: string | null;
  run: PluginRunView | null;
  freshness: FreshnessView | null;
  unreadable: boolean;
  status: SensorRowStatus;
};

export type CatalogView =
  | { state: "read" }
  | { state: "unavailable"; reason: string };

export type RunActivity = {
  busy: boolean;
  external: boolean;
};

export function acceptRevision(
  held: HeldRevision | null,
  stream: string,
  state: RepositoryState,
): HeldRevision {
  if (
    held !== null &&
    held.stream === stream &&
    held.state.repository === state.repository &&
    state.revision <= held.state.revision
  ) {
    return held;
  }

  return { stream, state };
}

function isActive(run: RunView | null): run is RunView {
  return run !== null && (run.state === "checking" || run.state === "running");
}

export function activityOf(run: RunView | null, ownRun: boolean): RunActivity {
  const active = isActive(run);

  return {
    busy: active,
    external: active && !ownRun,
  };
}

export function runActivity(
  state: RepositoryState,
  ownRun: boolean,
): RunActivity {
  return activityOf(state.run, ownRun);
}

function statusOf(
  state: RepositoryState,
  name: string,
  registered: boolean,
  run: PluginRunView | null,
): SensorRowStatus {
  if (!registered) {
    return "off";
  }

  if (run?.state === "failed") {
    return "failed";
  }

  const entry = workingResult(state, name);

  if (entry === null) {
    return "not run";
  }

  if (entry.unreadable) {
    return "failed";
  }

  return state.freshness[name]?.state === "stale" ? "stale" : "ran";
}

export function sensorRows(state: RepositoryState): SensorRow[] {
  const plugins = state.run?.plugins ?? [];

  return state.registry.entries.map((entry) => {
    const run = plugins.find((plugin) => plugin.name === entry.name) ?? null;
    const unreadable = (state.results[entry.name]?.results ?? []).some(
      (result) => result.unreadable,
    );

    return {
      name: entry.name,
      display: entry.manifest?.display ?? entry.name,
      registered: entry.registered,
      reason: entry.reason,
      run,
      freshness: state.freshness[entry.name] ?? null,
      unreadable,
      status: statusOf(state, entry.name, entry.registered, run),
    };
  });
}

export function registeredRows(state: RepositoryState): SensorRow[] {
  return sensorRows(state).filter((row) => row.registered);
}

export function catalogView(state: RepositoryState): CatalogView {
  const { catalog } = state.registry;

  return catalog.state === "unreadable"
    ? { state: "unavailable", reason: catalog.reason }
    : { state: "read" };
}

export function resultsChanged(
  before: RepositoryState | null,
  after: RepositoryState,
  name: string,
): boolean {
  const key = (state: RepositoryState | null): string =>
    JSON.stringify(
      (state?.results[name]?.results ?? []).map((entry) => [
        entry.commit,
        entry.modified,
        entry.findings,
        entry.overlay,
        entry.inputsDigest,
        entry.testsDigest,
        entry.unreadable,
      ]),
    );

  return key(before) !== key(after);
}

export function lastFinishedAt(state: RepositoryState | null): number | null {
  const run = state?.run ?? null;

  if (run === null || run.state !== "finished" || run.endedAt === null) {
    return null;
  }

  const at = Date.parse(run.endedAt);

  return Number.isNaN(at) ? null : at;
}

export function ranAtOf(
  scannedAt: number,
  state: RepositoryState | null,
): number {
  return Math.max(scannedAt, lastFinishedAt(state) ?? 0);
}

export function panelChanged(
  before: RepositoryState,
  after: RepositoryState,
): boolean {
  const key = (state: RepositoryState): string =>
    JSON.stringify([
      state.registry,
      state.results,
      state.freshness,
      state.unreadableReports,
      state.inputsDigest,
      lastFinishedAt(state),
    ]);

  return key(before) !== key(after);
}

export function installedSensorsOf(state: RepositoryState): InstalledSensors {
  const { catalog, entries } = state.registry;

  if (catalog.state === "unreadable") {
    return { status: "unavailable", reason: catalog.reason };
  }

  const sensors: InstalledSensor[] = [];

  for (const entry of entries) {
    const facts = entry.manifest;

    if (facts === null) {
      continue;
    }

    sensors.push({
      name: entry.name,
      display: facts.display,
      description: facts.description ?? "",
      ...(facts.expansion === undefined ? {} : { expansion: facts.expansion }),
      ...(facts.settingsTitle === undefined
        ? {}
        : { settings_title: facts.settingsTitle }),
      runsTests: facts.runsTests,
      scoped: facts.scoped,
      ...(facts.plannedWork === undefined
        ? {}
        : { plannedWork: facts.plannedWork }),
      ...(facts.logPath === undefined ? {} : { logPath: facts.logPath }),
      listed: facts.listed,
      metrics: [...(facts.metrics ?? [])] as InstalledMetric[],
      findings: [...(facts.findings ?? [])] as InstalledSensor["findings"],
      settings: [...(facts.settings ?? [])] as InstalledSetting[],
    });
  }

  return { status: "ok", sensors };
}

export function storedResultsOf(documents: ResultDocuments): StoredResults {
  const findings: FindingsFiles = { files: [], refused: [] };
  const overlays: OverlayFiles = { files: [], refused: [] };
  const freshness: StoredResults["freshness"] = {};

  for (const [name, one] of Object.entries(documents.plugins)) {
    const { modifiedMs } = one;

    if (one.findingsProblem !== null) {
      findings.refused.push(name);
    } else if (
      one.findings !== null &&
      one.shown !== null &&
      one.hidden !== null &&
      one.measured !== null
    ) {
      findings.files.push({
        name,
        document: one.findings,
        modifiedMs,
        shown: one.shown,
        hidden: one.hidden,
        measured: one.measured,
        suites: one.suites,
      });

      if (one.freshness !== null) {
        freshness[name] = one.freshness;
      }
    }

    if (one.overlayProblem !== null) {
      overlays.refused.push(name);
    } else if (one.overlay !== null) {
      overlays.files.push({ name, overlay: one.overlay, modifiedMs });
    }
  }

  return {
    findings,
    overlays,
    refusals: documents.refusals,
    freshness,
    lastRun: documents.lastRun,
  };
}
