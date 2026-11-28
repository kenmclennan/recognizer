import type { ConfigRepository } from "../../domain/config-repository.js";
import type {
  CommitResults,
  FindingsRepository,
  StoredFindings,
  StoredOverlay,
} from "../../domain/findings-repository.js";
import { InvalidEntity } from "../../domain/invalid-entity.js";
import type { PolicyRepository } from "../../domain/policy-repository.js";
import type { Repository } from "../../domain/repository.js";
import type {
  ActiveRunRead,
  ActiveRunRepository,
  MarkerFacts,
  ReadCursor,
} from "../../domain/run/active-run-repository.js";
import type { RepositoryState } from "../../domain/run/repository-state.js";
import { ResultFreshness } from "../../domain/run/result-freshness.js";
import {
  type ResultAt,
  type ResultEntry,
  ResultSet,
} from "../../domain/run/result-set.js";
import {
  type PlannedEstimates,
  Run,
  type RunReport,
} from "../../domain/run/run.js";
import {
  type InstalledFacts,
  type ManifestFacts,
  SensorRegistry,
} from "../../domain/run/sensor-registry.js";
import type { RunLogRepository } from "../../domain/run-log-repository.js";
import type { StructureRepository } from "../../domain/structure-repository.js";
import type {
  InstalledRead,
  SensorInEffect,
} from "../plugins/installed-sensors.js";
import type { Clock } from "../shared/ports/clock.js";
import type { BaselineText, CurrentTests } from "./ports/current-tests.js";
import { workOutFreshness } from "./work-out-freshness.js";

export interface HeldCatalog {
  sensorsInEffect(): SensorInEffect[];
  unreadableFolders(): string[];
  readInstalled(): InstalledRead;
}

export interface RepositoryStateDependencies {
  active: ActiveRunRepository;
  runLog: RunLogRepository;
  config: ConfigRepository;
  catalog: HeldCatalog;
  findings: FindingsRepository;
  structure: StructureRepository;
  policy: PolicyRepository;
  baseline: BaselineText;
  currentTests: CurrentTests;
  clock: Clock;
}

export type StateListener = (state: RepositoryState) => void;

interface Settling {
  runId: string;
  log: boolean;
  marker: boolean;
}

const UNKNOWN_DIGEST_READS = 5;

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function factsOf(read: InstalledRead): InstalledFacts {
  const readable = new Map<string, ManifestFacts>();

  for (const sensor of read.sensors) {
    readable.set(sensor.name, {
      display: sensor.display,
      runsTests: sensor.runs_tests,
      scoped: sensor.scoped,
      listed: sensor.listed,
      ...(sensor.description === undefined
        ? {}
        : { description: sensor.description }),
      ...(sensor.expansion === undefined
        ? {}
        : { expansion: sensor.expansion }),
      ...(sensor.settings_title === undefined
        ? {}
        : { settingsTitle: sensor.settings_title }),
      ...(sensor.planned_work === undefined
        ? {}
        : { plannedWork: sensor.planned_work }),
      ...(sensor.log_path === undefined ? {} : { logPath: sensor.log_path }),
      metrics: sensor.metrics,
      findings: sensor.findings,
      settings: sensor.settings,
      ...(sensor.principles === undefined
        ? {}
        : { principles: sensor.principles }),
    });
  }

  return {
    readable,
    unreadable: new Map(read.unreadable.map((one) => [one.name, one.reason])),
  };
}

export class RepositoryStateHolder {
  private revision = 0;
  private published: RepositoryState | null = null;
  private serialised: string | null = null;
  private readonly listeners = new Set<StateListener>();
  private run: Run | null = null;
  private cursor: ReadCursor | null = null;
  private registry = SensorRegistry.unknown();
  private registered: string[] = [];
  private installed: InstalledFacts | null = null;
  private catalogNames: string | null = null;
  private results = ResultSet.empty();
  private readonly finishedSeen = new Set<string>();
  private freshness = new Map<string, ResultFreshness>();
  private freshnessKey: string | null = null;
  private inputsDigest = "";
  private testsDigest: string | null | undefined = undefined;
  private lastGoodTestsDigest: string | null = null;
  private unknownDigestReads = 0;
  private digestChanges = 0;
  private digestVerified = true;
  private readonly storedAt = new Map<string, ResultAt>();
  private overlayNames = new Set<string>();
  private readonly commitEntries = new Map<
    string,
    { name: string; at: ResultAt }
  >();
  private unreadableReports = 0;
  private settling: Settling | null = null;
  private readonly settled = new Set<string>();
  private killedRunning: string[] = [];
  private pendingPlan: PlannedEstimates | null = null;

  constructor(
    readonly root: string,
    private readonly deps: RepositoryStateDependencies,
  ) {}

  current(): RepositoryState {
    if (this.published === null) {
      this.refresh();
    }

    return this.published as RepositoryState;
  }

  expectPlan(planned: PlannedEstimates | null): void {
    this.pendingPlan = planned;
  }

  active(): boolean {
    return this.run?.active === true;
  }

  subscribe(listener: StateListener): () => void {
    listener(this.current());
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  refresh(): void {
    this.readRun();
    this.readRegistry();
    this.readResults();
    this.readInputs();
    this.workOutFreshness();
    this.publish();
  }

  private readRun(): void {
    let read: ActiveRunRead;

    try {
      read = this.deps.active.read(this.root, this.cursor);
    } catch (error) {
      read = { kind: "unreadable", reason: reasonOf(error) };
    }

    if (read.kind === "none") {
      this.run = null;
      this.cursor = null;

      return;
    }

    if (read.kind === "unreadable") {
      return;
    }

    const { record } = read;

    if (this.run === null || this.run.id !== record.runId) {
      const planned = record.startedBy === "app" ? this.pendingPlan : null;

      if (record.startedBy === "app") {
        this.pendingPlan = null;
      }

      this.run = Run.begin({
        ...(planned === null ? {} : { planned }),
        id: record.runId,
        startedBy: record.startedBy,
        startedAt: record.startedAt,
        scope: record.scope,
        choices: {
          sensors: record.sensors,
          describe: record.describe,
          suites: record.suites,
        },
      });
    }

    for (const report of read.reports) {
      this.apply(report);
    }

    this.cursor = { runId: record.runId, offset: read.offset };
    this.reconcile(read, record);

    if (read.kind === "killed") {
      this.settleKilled(record);
    }
  }

  private apply(report: RunReport): void {
    if (this.run === null) {
      return;
    }

    if (report.kind === "unreadable") {
      this.unreadableReports += 1;

      return;
    }

    try {
      this.run = this.run.apply(report, this.deps.clock.awake());

      if (report.kind === "plugin-result") {
        this.results = this.results.reported(
          report.name,
          report.at,
          report.result,
        );
      }
    } catch (error) {
      if (error instanceof InvalidEntity) {
        this.unreadableReports += 1;

        return;
      }

      throw error;
    }
  }

  private reconcile(read: ActiveRunRead, record: MarkerFacts): void {
    if (this.run === null || !this.run.active) {
      return;
    }

    if (read.kind === "killed") {
      this.killedRunning = this.run.running();
      this.run = this.run.stopped(record.endedAt, this.deps.clock.awake());

      return;
    }

    if (read.kind === "ended") {
      this.apply({
        kind: "ended",
        end: {
          state: record.phase as "finished" | "failed" | "stopped" | "refused",
          endedAt: record.endedAt,
          exit: record.exit,
          gaps: record.gaps,
          failure: record.failure,
          ran: record.ran,
        },
      });

      return;
    }

    if (record.phase === "running" && this.run.state === "checking") {
      this.apply({ kind: "running" });
    }
  }

  private settleKilled(record: MarkerFacts): void {
    if (this.settled.has(record.runId)) {
      return;
    }

    const progress: Settling =
      this.settling !== null && this.settling.runId === record.runId
        ? this.settling
        : { runId: record.runId, log: false, marker: false };

    this.settling = progress;

    try {
      if (!progress.log) {
        this.deps.runLog.settleKilled(this.root, {
          runId: record.runId,
          startedAt: record.startedAt,
          startedBy: record.startedBy,
          running: this.killedRunning,
        });
        progress.log = true;
      }

      if (!progress.marker) {
        this.deps.active.settleKilled(this.root, record);
        progress.marker = true;
      }

      this.settled.add(record.runId);
    } catch {
      return;
    }
  }

  private readRegistry(): void {
    try {
      const inEffect = this.deps.catalog.sensorsInEffect();
      const key = JSON.stringify(inEffect);
      const folders = this.deps.catalog.unreadableFolders();

      this.registered = [...new Set(inEffect.map(({ name }) => name))];

      if (this.installed === null || key !== this.catalogNames) {
        const read = factsOf(this.deps.catalog.readInstalled());
        const missing = this.registered.filter(
          (name) => !read.readable.has(name) && !read.unreadable.has(name),
        );

        if (folders.length > 0 && missing.length > 0) {
          if (this.installed === null) {
            throw new Error(
              `the plugin folders ${folders.join(", ")} cannot be read`,
            );
          }
        } else {
          this.installed = read;
          this.catalogNames = key;
        }
      }
    } catch (error) {
      this.catalogNames = null;
      this.registry = this.registry.unreadable(
        reasonOf(error),
        this.registered,
      );

      return;
    }

    this.registry = SensorRegistry.read(
      this.registered,
      this.installed as InstalledFacts,
    );
  }

  private readResults(): void {
    let stored: StoredFindings[];

    try {
      stored = this.deps.findings.readAll(this.root);
    } catch {
      return;
    }

    const invalidOverlays = this.readOverlays();
    const wanted = new Set(this.registered);
    const fresh = new Map<string, ResultEntry>();

    for (const one of stored) {
      if (!wanted.has(one.name)) {
        continue;
      }

      if (one.status === "invalid") {
        this.results = this.results.flaggedUnreadable(one.name);

        continue;
      }

      const { document } = one;
      const at = { commit: document.commit, modified: document.modified };
      const result = {
        findings: `findings:${one.name}`,
        overlay: this.overlayNames.has(one.name) ? `overlay:${one.name}` : null,
        inputsDigest:
          document.inputs === undefined
            ? null
            : ResultSet.inputsDigestOf(document.inputs),
        testsDigest: document.tests ?? null,
        reportedAt: document.reportedAt ?? null,
        inputs: document.inputs ?? null,
      };

      const entry: ResultEntry = {
        at,
        result: { ...result, unreadable: false },
      };

      const previous = this.storedAt.get(one.name);

      if (previous !== undefined) {
        this.results = this.results.without(one.name, previous);
      }

      this.storedAt.set(one.name, at);
      this.results = this.results.reported(one.name, at, result);
      fresh.set(one.name, entry);
    }

    this.replaceFinished(fresh);

    for (const name of invalidOverlays) {
      this.results = this.results.flaggedUnreadable(name);
    }

    this.readCommitResults(wanted);
  }

  private readCommitResults(wanted: ReadonlySet<string>): void {
    let commits: CommitResults[];

    try {
      commits = this.deps.findings.readCommits(this.root);
    } catch {
      return;
    }

    const seen = new Set<string>();

    for (const { commit, stored, overlays } of commits) {
      const overlayNames = new Set(
        overlays.filter((one) => one.status === "read").map((one) => one.name),
      );

      for (const one of stored) {
        if (!wanted.has(one.name)) {
          continue;
        }

        const at: ResultAt = { commit, modified: false };
        const key = `${one.name}\u0000${commit}`;
        const working = this.storedAt.get(one.name);

        if (
          working !== undefined &&
          working.commit === commit &&
          !working.modified
        ) {
          continue;
        }

        seen.add(key);
        this.commitEntries.set(key, { name: one.name, at });

        if (one.status === "invalid") {
          this.results = this.results.flaggedUnreadableAt(one.name, at);

          continue;
        }

        const { document } = one;

        this.results = this.results.reported(one.name, at, {
          findings: `findings:${one.name}@${commit}`,
          overlay: overlayNames.has(one.name)
            ? `overlay:${one.name}@${commit}`
            : null,
          inputsDigest:
            document.inputs === undefined
              ? null
              : ResultSet.inputsDigestOf(document.inputs),
          testsDigest: document.tests ?? null,
          reportedAt: document.reportedAt ?? null,
          inputs: document.inputs ?? null,
        });
      }
    }

    for (const [key, { name, at }] of [...this.commitEntries]) {
      if (!seen.has(key)) {
        this.results = this.results.without(name, at);
        this.commitEntries.delete(key);
      }
    }
  }

  private readOverlays(): string[] {
    let stored: StoredOverlay[];

    try {
      stored = this.deps.findings.readOverlays(this.root);
    } catch {
      return [];
    }

    this.overlayNames = new Set(stored.map((one) => one.name));

    return stored
      .filter((one) => one.status === "invalid")
      .map((one) => one.name);
  }

  private readInputs(): void {
    try {
      this.inputsDigest = [
        this.deps.policy.text(this.root).hash,
        this.deps.config.text(this.root).hash,
        this.deps.baseline.hash(this.root),
      ].join(":");
    } catch {
      return;
    }
  }

  private replaceFinished(fresh: ReadonlyMap<string, ResultEntry>): void {
    const run = this.run;

    if (run === null || run.scope.kind !== "working-tree") {
      return;
    }

    for (const plugin of run.plugins) {
      const key = `${run.id}:${plugin.name}`;
      const entry = fresh.get(plugin.name);

      if (
        plugin.state !== "finished" ||
        this.finishedSeen.has(key) ||
        entry === undefined
      ) {
        continue;
      }

      this.finishedSeen.add(key);
      this.results = this.results.replaced(plugin.name, run, [entry]);
    }
  }

  private currentTestsDigest(): string | null {
    if (this.testsDigest !== undefined) {
      return this.testsDigest;
    }

    let digest: string | null;

    try {
      digest = this.deps.currentTests.digest(this.root);
    } catch {
      return this.lastGoodTestsDigest;
    }

    if (digest === null && this.unknownDigestReads < UNKNOWN_DIGEST_READS) {
      this.unknownDigestReads += 1;

      return this.lastGoodTestsDigest;
    }

    if (digest !== this.lastGoodTestsDigest) {
      this.digestChanges += 1;
    }

    this.testsDigest = digest;
    this.lastGoodTestsDigest = digest;

    return digest;
  }

  private structureOf(): Repository | null {
    try {
      return this.deps.structure.exists(this.root)
        ? this.deps.structure.read(this.root)
        : null;
    } catch {
      return null;
    }
  }

  testsDigestChanges(): number {
    return this.digestChanges;
  }

  readTestsDigest(): void {
    this.digestVerified = false;
    this.testsDigest = undefined;
    this.unknownDigestReads = 0;
    this.freshnessKey = null;
    this.currentTestsDigest();
  }

  verifyTestsDigest(): void {
    this.digestVerified = true;
    this.refresh();
  }

  workingTreeChanged(): void {
    this.testsDigest = undefined;
    this.unknownDigestReads = 0;
    this.freshnessKey = null;
    this.refresh();
  }

  private workingEntries(name: string): ResultEntry[] {
    const entries = this.results.of(name);
    const stored = this.storedAt.get(name);

    if (stored === undefined) {
      return entries;
    }

    const held = entries.filter(
      ({ at }) =>
        at.commit === stored.commit && at.modified === stored.modified,
    );

    return held.length === 0 ? entries : held;
  }

  private workOutFreshness(): void {
    if (!this.digestVerified) {
      return;
    }

    const currentTests = this.currentTestsDigest();
    const key = JSON.stringify([
      currentTests,
      this.registered,
      this.results.view(this.registered),
      this.run?.id ?? null,
      this.run?.state ?? null,
    ]);

    if (key === this.freshnessKey) {
      return;
    }

    const structure = this.structureOf();
    const next = new Map<string, ResultFreshness>();

    for (const name of this.registered) {
      const scoped =
        this.registry.entries.find((entry) => entry.name === name)?.manifest
          ?.scoped ?? false;

      next.set(
        name,
        workOutFreshness(
          this.workingEntries(name),
          structure,
          scoped,
          currentTests,
        ),
      );
    }

    this.freshness = next;
    this.freshnessKey = key;
  }

  private publish(): void {
    const state: RepositoryState = {
      repository: this.root,
      revision: 0,
      registry: this.registry.view(),
      run: this.run === null ? null : this.run.view(),
      results: this.results.view(this.registered),
      freshness: Object.fromEntries(
        this.registered.map((name) => [
          name,
          (this.freshness.get(name) ?? ResultFreshness.checking()).view(),
        ]),
      ),
      unreadableReports: this.unreadableReports,
      inputsDigest: this.inputsDigest,
    };
    const text = JSON.stringify(state);

    if (text === this.serialised) {
      return;
    }

    this.serialised = text;
    this.revision += 1;
    this.published = { ...state, revision: this.revision };

    for (const listener of [...this.listeners]) {
      listener(this.published);
    }
  }
}
