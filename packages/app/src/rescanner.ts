import type { Diagnosis, RunView } from "@recognizer/core";
import {
  idlePhases,
  nothingRanText,
  onlyArmed,
  type ScanRunRecord,
} from "recognizer";
import type { ScanOrigin } from "./footer-scan";
import { ANALYSIS_KEY } from "./freshness-text";
import { loadedUnchanged, sameStructure } from "./loaded-unchanged";
import type { MessageAction, MessageInput } from "./message-tray";
import { activityOf } from "./repository-state-model";
import { runLogPath } from "./run-log-path";
import { type RunChange, runChangesBetween } from "./run-snapshot-events";
import type { PlannedRun } from "./scan-freshness";
import type { Loaded } from "./scan-loading";
import {
  DESCRIBE_KEY,
  effectiveTicks,
  NO_RUN,
  type RowSensor,
  type RunState,
  type ScanTicks,
} from "./scan-panel-model";
import type { RunEvent, ScanPort, ScanRunResult } from "./scan-port";
import {
  NO_OVERLAY,
  NO_TIMING,
  type ProgressOverlay,
  progressOfRun,
  type RunProgress,
  type RunRow,
  type ScanTiming,
  type ShowTarget,
  scanningText,
  stampTiming,
} from "./scan-progress";
import type { ScanReport } from "./scan-report";
import type { RunInput } from "./scan-run-model";

export type Registered = {
  sensors: Pick<
    RowSensor,
    "name" | "display" | "runsTests" | "registered" | "suites"
  >[];
  describerRegistered: boolean;
};

export type ProgressUpdate = {
  scanning: string | null;
};

export type RunSnapshotPort = {
  run: () => RunView | null;
  onRun: (handler: (run: RunView | null) => void) => () => void;
};

export type RescanPorts<Carried> = {
  port: ScanPort;
  snapshot: RunSnapshotPort;
  registered: () => Promise<Registered>;
  load: (report: ScanReport) => Loaded;
  sense: (loaded: Loaded) => Promise<Loaded>;
  resense: () => Promise<Loaded | null>;
  adopt: () => Promise<ScanOrigin>;
  carry: () => Carried | null;
  replace: (loaded: Loaded, carried: Carried | null) => void;
  update: (loaded: Loaded) => boolean;
  adopted: (origin: ScanOrigin) => void;
  describedLine: () => void;
  progress: (update: ProgressUpdate) => void;
  settled: () => void;
  attached: () => void;
  hasExplorer: () => boolean;
  blocked: (text: string) => void;
  post: (input: MessageInput) => number | null;
  attach: (id: number, extra: MessageAction) => void;
  openLog: (log: string) => void;
  show: (target: ShowTarget) => void;
  now?: () => number;
  awake?: () => number;
};

export type Rescanner = {
  run: (modules?: string[] | null, planned?: PlannedRun) => Promise<void>;
  stop: () => Promise<void>;
  answerDescribe: (describe: boolean) => Promise<void>;
  refresh: () => Promise<void>;
  loadTicks: () => Promise<void>;
  ticks: () => ScanTicks;
  setTicks: (next: ScanTicks) => void;
  runState: () => RunState;
  running: () => boolean;
  external: () => boolean;
  progress: () => RunProgress;
  runView: () => RunInput;
};

const DEFAULT_TICKS: ScanTicks = {
  describe: false,
  analysis: true,
  ticked: [],
  armed: [],
  onlyView: false,
  suites: {},
  folds: [],
};

function failureText(result: ScanRunResult): string | null {
  switch (result.status) {
    case "command-missing":
      return result.hint;
    case "failed":
      return result.stderr.trim() === ""
        ? `recognizer scan exited ${result.exitCode}`
        : result.stderr.trim();
    case "refused":
      return result.reason;
    default:
      return null;
  }
}

export function durationText(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function refusedText(gaps: ScanRunRecord["gaps"]): string {
  const first = gaps[0];
  const count = `${gaps.length} ${gaps.length === 1 ? "problem" : "problems"}`;

  return first === undefined ? count : `${count}: ${first.line}`;
}

function startedText(names: string): string {
  return names === "" ? "Scan started" : `Scan started - ${names}`;
}

function isActive(record: ScanRunRecord | null): boolean {
  return (
    record !== null &&
    (record.phase === "checking" || record.phase === "running")
  );
}

function namesHeading(text: string, heading: string): boolean {
  if (text.startsWith(heading)) {
    return true;
  }

  const name = heading.replace(/^Running /, "").replace(/\u2026$/, "");

  return (
    heading.startsWith("Running ") && name !== "" && text.startsWith(`${name}:`)
  );
}

export function createRescanner<Carried>(
  ports: RescanPorts<Carried>,
): Rescanner {
  let own: Promise<void> | null = null;
  let activeSeen: string | null = null;
  let attachedToOther = false;
  let seenRun: RunView | null = null;
  let applied: Loaded | null = null;
  let ticks: ScanTicks = DEFAULT_TICKS;
  let remembered = false;
  let ticksLoaded = false;
  let run: RunState = NO_RUN;
  let progressRunId: string | null = null;
  let overlay: ProgressOverlay = NO_OVERLAY;
  let timing: ScanTiming = NO_TIMING;
  let processed: RunView | null = null;
  let queueSeen: RunView | null = null;
  let linkedFailures = new Set<number>();

  let rows: RunRow[] = [];
  let heading: string | null = null;
  let failureIds: number[] = [];
  let splitting: Promise<void> = Promise.resolve();
  let lastUpdate: ProgressUpdate = { scanning: null };
  let record: ScanRunRecord | null = null;
  let begunRunId: string | null = null;
  let liveRunId: string | null = null;
  let endedRunId: string | null = null;
  let ownEnd: ScanRunRecord | null = null;
  let starting: { at: number } | null = null;
  let scanStartedWall: number | null = null;
  let startedFrom: string | null = null;
  let ownRunId: string | null = null;
  let adoptedAtOpen: string | null = null;
  let seenFirst = false;
  let adoptedThisScan = false;
  const wallNow = ports.now ?? Date.now;
  const now = ports.awake ?? wallNow;
  let externalQueue: Promise<void> = Promise.resolve();

  function progressNow(): RunProgress {
    const shown =
      progressRunId !== null && seenRun !== null && seenRun.id === progressRunId
        ? seenRun
        : null;

    return progressOfRun(shown, timing, overlay);
  }

  function resetProgress() {
    progressRunId = null;
    overlay = NO_OVERLAY;
    timing = NO_TIMING;
  }

  function emit(update: { scanning: string | null }) {
    lastUpdate = { ...update };
    ports.progress(lastUpdate);
  }

  function publish() {
    const text = scanningText(rows, run.started, progressNow());

    emit({
      scanning:
        text === null || heading === null || namesHeading(text, heading)
          ? text
          : `${heading} ${text}`,
    });
  }

  function names(display: string[], describe: boolean): string {
    return [...display, ...(describe ? ["describe"] : [])].join(", ");
  }

  async function writeTicks(registered: Registered) {
    const plain = registered.sensors
      .filter(({ runsTests }) => !runsTests)
      .map(({ name }) => name);

    await ports.port.writeTicks({
      describe: ticks.describe,
      analysis: ticks.analysis,
      ticked: [
        ...(ticks.ticked ?? plain).filter((name) => plain.includes(name)),
        ...ticks.armed.filter(
          (name) =>
            !plain.includes(name) &&
            registered.sensors.some(
              (one) => one.name === name && one.runsTests,
            ),
        ),
      ],
      onlyView: ticks.onlyView,
      suites: ticks.suites,
      folds: ticks.folds,
    });
    remembered = true;
  }

  function apply(loaded: Loaded) {
    const previous = applied;

    applied = loaded;

    if (sameStructure(previous, loaded) && ports.update(loaded)) {
      return;
    }

    ports.replace(loaded, ports.carry());
  }

  async function settle(): Promise<boolean> {
    try {
      if (adoptedThisScan) {
        return true;
      }

      const scanned = ports.load(await ports.port.readCache());

      if (scanned.blocking !== null) {
        ports.blocked(scanned.blocking);

        return false;
      }

      const loaded = await ports.sense(scanned);
      const origin = await ports.adopt();

      adoptedThisScan = true;
      ports.adopted(origin);
      apply(loaded);

      return true;
    } catch (error) {
      ports.blocked(String(error));

      return false;
    } finally {
      ports.settled();
    }
  }

  async function openFromCache(): Promise<boolean> {
    if (ports.hasExplorer() || adoptedThisScan) {
      return false;
    }

    try {
      const cached = ports.load(await ports.port.readCache());

      if (cached.blocking !== null || cached.scans.length === 0) {
        return false;
      }

      const loaded = await ports.sense(cached);
      const origin = await ports.adopt();

      adoptedThisScan = true;
      ports.adopted(origin);
      apply(loaded);

      return true;
    } catch {
      return false;
    }
  }

  async function openRefused(text: string) {
    if (ports.hasExplorer()) {
      return;
    }

    if (!(await openFromCache())) {
      ports.blocked(text);
    }
  }

  async function reload() {
    const loaded = await ports.resense();

    if (loaded === null || loadedUnchanged(applied, loaded)) {
      return;
    }

    apply(loaded);
  }

  function postFailure(name: string, reason: string) {
    const target: ShowTarget = { kind: "sensor", name, reason };

    remember(
      ports.post({
        kind: "error",
        text: `${name} failed: ${reason}`,
        action: { label: "Show", run: () => ports.show(target) },
      }),
    );
  }

  function remember(id: number | null) {
    if (id !== null) {
      failureIds.push(id);
    }
  }

  function postDescribed() {
    const described = progressNow().describe;

    if (described === null) {
      return;
    }

    const first = described.firstFailure;

    const id = ports.post({
      kind: "info",
      text: `Describe wrote ${described.done - described.failed} lines, ${described.failed} files failed.`,
      ...(first === null
        ? {}
        : {
            action: {
              label: "Show" as const,
              run: () =>
                ports.show({
                  kind: "module",
                  id: first.item,
                  reason: first.reason,
                }),
            },
          }),
    });

    if (first !== null) {
      remember(id);
    }
  }

  function finished(
    name: string,
    ok: boolean,
    reason: string,
    diagnosis: Diagnosis | null = null,
  ) {
    const failures = { ...run.failures };
    const diagnoses = { ...run.diagnoses };

    if (ok) {
      delete failures[name];
    } else {
      failures[name] = reason;
    }

    if (ok || diagnosis === null) {
      delete diagnoses[name];
    } else {
      diagnoses[name] = diagnosis;
    }

    const running = run.running.filter((one) => one !== name);
    const next = running.find((one) => one !== DESCRIBE_KEY) ?? null;

    run = {
      running,
      started: run.started === name ? next : run.started,
      failures,
      diagnoses,
      ranAt: { ...run.ranAt, [name]: Date.now() },
    };
  }

  function settleStopped(name: string) {
    const running = run.running.filter((one) => one !== name);
    const next = running.find((one) => one !== DESCRIBE_KEY) ?? null;

    run = {
      ...run,
      running,
      started: run.started === name ? next : run.started,
    };
  }

  type Effect = () => Promise<void> | void;

  function applyChange(change: RunChange): Effect | null {
    switch (change.kind) {
      case "describe-started":
        run = { ...run, started: DESCRIBE_KEY };

        return null;
      case "described":
        return () => ports.describedLine();
      case "describe-ended":
        if (change.outcome === "stopped") {
          settleStopped(DESCRIBE_KEY);
        } else {
          finished(DESCRIBE_KEY, change.outcome === "ok", change.reason);
        }

        return null;
      case "sense-started":
        run = { ...run, started: change.name };

        return null;
      case "sense-ended":
        if (change.outcome === "stopped") {
          settleStopped(change.name);
        } else {
          finished(
            change.name,
            change.outcome === "ok",
            change.reason,
            change.diagnosis,
          );
        }

        if (change.outcome === "failed") {
          postFailure(change.name, change.reason);
        }

        return () => reload();
      case "extract-ended":
        if (change.outcome === "failed") {
          remember(
            ports.post({
              kind: "error",
              text: `${change.name} failed: ${change.reason}`,
            }),
          );
        }

        return null;
    }
  }

  async function drain() {
    const after = queueSeen;

    if (liveRunId === null || after === null || after.id !== liveRunId) {
      return;
    }

    const base =
      processed !== null && processed.id === after.id ? processed : null;
    const wasSettled =
      overlay.extractSettled ||
      (base !== null && progressOfRun(base).extractSettled);

    processed = after;
    timing = stampTiming(timing, after, now());

    const effects: Effect[] = [];

    for (const change of runChangesBetween(base, after)) {
      const effect = applyChange(change);

      if (effect !== null) {
        effects.push(effect);
      }
    }

    publish();

    if (!wasSettled && progressOfRun(after, timing, overlay).extractSettled) {
      await settle();
      publish();
    }

    for (const effect of effects) {
      await effect();
    }
  }

  function linkLog() {
    const log = progressNow().log;

    if (log === null) {
      return;
    }

    const path = runLogPath(log);
    const open: MessageAction = {
      label: "Open log",
      run: () => ports.openLog(path),
    };

    for (const id of failureIds) {
      if (!linkedFailures.has(id)) {
        linkedFailures.add(id);
        ports.attach(id, open);
      }
    }
  }

  async function beginRun(scan: ScanRunRecord) {
    const registered = await ports.registered();
    const display = (name: string) =>
      registered.sensors.find((one) => one.name === name)?.display ?? name;

    begunRunId = scan.run_id;
    liveRunId = scan.run_id;
    adoptedThisScan = own !== null ? adoptedThisScan : false;
    failureIds = [];
    linkedFailures = new Set();
    rows = [
      ...(scan.describe
        ? [{ key: DESCRIBE_KEY, display: "Descriptions" }]
        : []),
      ...scan.sensors.map((name) => ({ key: name, display: display(name) })),
    ];
    resetProgress();
    progressRunId = scan.run_id;
    run = {
      running: [...(scan.describe ? [DESCRIBE_KEY] : []), ...scan.sensors],
      started: null,
      failures: run.failures,
      diagnoses: run.diagnoses,
      ranAt: run.ranAt,
    };
    ports.post({
      kind: "info",
      text: startedText(names(scan.sensors.map(display), scan.describe)),
    });
    publish();
    await drain();
  }

  function endText(scan: ScanRunRecord): MessageInput | null {
    if (scan.phase === "finished") {
      const began = Date.parse(scan.started_at);
      const ended = Date.parse(scan.ended_at ?? scan.started_at);

      return {
        kind: "done",
        text: `Scan complete - ${durationText(
          Number.isNaN(began) || Number.isNaN(ended) ? 0 : ended - began,
        )}`,
      };
    }

    if (scan.phase === "failed") {
      return {
        kind: "error",
        text: `Scan failed - ${
          scan.failure === null
            ? `recognizer scan exited ${scan.exit ?? 1}`
            : `${scan.failure.sensor}: ${scan.failure.reason}`
        }`,
      };
    }

    return null;
  }

  async function endRun(scan: ScanRunRecord) {
    if (endedRunId === scan.run_id) {
      return;
    }

    endedRunId = scan.run_id;
    liveRunId = null;
    run = { ...run, running: [], started: null };
    starting = null;

    if (scan.phase === "refused") {
      const text = refusedText(scan.gaps);

      ports.post({ kind: "warning", text: `Scan refused - ${text}` });
      overlay = { ...overlay, done: true };
      publish();
      await openRefused(text);
      ports.settled();

      return;
    }

    if (scan.phase !== "finished" && scan.phase !== "failed") {
      overlay = { ...overlay, stopped: true };
      publish();

      try {
        await reload();
      } catch (error) {
        ports.post({ kind: "error", text: `Sensors failed: ${String(error)}` });
      }

      ports.settled();

      return;
    }

    const idle = scan.exit === 0 || scan.exit === 1 ? idlePhases(scan) : [];

    if (idle.length > 0) {
      const text = nothingRanText(idle);

      resetProgress();
      emit({ scanning: null });
      ports.post({ kind: "error", text: `Scan failed - ${text}` });
      await openFromCache();
      ports.blocked(text);
      ports.settled();

      return;
    }

    const message = endText(scan);

    if (message !== null) {
      ports.post(message);
    }

    if (!progressNow().extractSettled) {
      overlay = { ...overlay, extractSettled: true };
      await settle();
    }

    if (adoptedThisScan || ports.hasExplorer()) {
      try {
        await reload();
      } catch (error) {
        ports.post({
          kind: "error",
          text: `Sensors failed: ${String(error)}`,
        });
      }
    }

    overlay = { ...overlay, done: true };
    postDescribed();
    publish();
    linkLog();

    ports.settled();
  }

  function takeOwnEnd(): ScanRunRecord | null {
    const ended = ownEnd;

    ownEnd = null;

    return ended;
  }

  async function vanished() {
    liveRunId = null;
    begunRunId = null;
    run = { ...run, running: [], started: null };
    resetProgress();
    emit({ scanning: null });

    try {
      await settle();
    } catch (error) {
      ports.post({ kind: "error", text: String(error) });
    }
  }

  function progressOfRecord(): RunProgress {
    const owned =
      record === null ||
      isActive(record) ||
      starting !== null ||
      record.run_id === begunRunId ||
      record.run_id === ownRunId;

    return owned ? progressNow() : progressOfRun(null);
  }

  async function takeRecord(next: ScanRunRecord | null) {
    if (next === null) {
      record = null;
      seenFirst = false;
      adoptedAtOpen = null;

      if (liveRunId !== null && own === null) {
        await vanished();
      }

      return;
    }

    if (!seenFirst) {
      seenFirst = true;

      if (!isActive(next)) {
        adoptedAtOpen = next.run_id;
      }
    }

    if (
      own !== null &&
      scanStartedWall !== null &&
      !isActive(next) &&
      Date.parse(next.started_at) < scanStartedWall
    ) {
      return;
    }

    if (starting !== null && next.run_id !== startedFrom) {
      starting = null;
    }

    if (own !== null && next.run_id !== startedFrom) {
      ownRunId = next.run_id;
    }

    record = next;

    const mine = own !== null && next.run_id === ownRunId;

    if (isActive(next)) {
      if (begunRunId !== next.run_id) {
        await beginRun(next);
      }

      return;
    }

    if (mine) {
      ownEnd = next;
    } else if (liveRunId === next.run_id) {
      await endRun(next);
    }
  }

  function onRun(event: RunEvent) {
    externalQueue = externalQueue
      .then(async () => {
        await takeRecord(event.run);

        ports.progress(lastUpdate);
      })
      .catch(() => {});
  }

  ports.port.onRun(onRun);

  seenRun = ports.snapshot.run();
  queueSeen = seenRun;
  processed = seenRun;

  ports.snapshot.onRun((next) => {
    seenRun = next;

    if (
      next !== null &&
      (next.state === "checking" || next.state === "running")
    ) {
      activeSeen = next.id;
    }

    const stopped =
      next !== null && next.state === "stopped" && next.id === activeSeen;

    if (stopped && !progressNow().stopped) {
      overlay = { ...overlay, stopped: true };
      publish();
    }

    externalQueue = externalQueue
      .then(async () => {
        queueSeen = next;
        await drain();
        linkLog();
        ports.progress(lastUpdate);
      })
      .catch(() => {});
  });

  async function execute(modules: string[] | null, planned?: PlannedRun) {
    try {
      await splitting;
      await executeScan(modules, planned);
    } finally {
      scanStartedWall = null;
      heading = null;
    }
  }

  async function executeScan(modules: string[] | null, planned?: PlannedRun) {
    attachedToOther = false;

    const registered = await ports.registered();

    if (!ticksLoaded) {
      await loadTicks();
    }

    const effective = effectiveTicks(
      ticks,
      registered.sensors,
      registered.describerRegistered,
    );
    const intent =
      planned?.plan ??
      (
        await ports.port.plan({
          repository: ".",
          mode: "rescan",
          ticks: effective,
          scope: modules,
          changed: [],
        })
      ).intent;
    const plan = onlyArmed(
      { ...intent, ...(planned === undefined ? { describeAll: false } : {}) },
      effective.armed,
      registered.sensors
        .filter(({ runsTests }) => runsTests)
        .map(({ name }) => name),
    );

    heading = planned?.progress ?? null;

    if (!remembered) {
      await writeTicks(registered);
    }

    failureIds = [];
    adoptedThisScan = false;
    rows = [
      ...(plan.analysis
        ? [{ key: ANALYSIS_KEY, display: "Structural analysis" }]
        : []),
      ...(plan.describe
        ? [{ key: DESCRIBE_KEY, display: "Descriptions" }]
        : []),
      ...plan.sense.map((name) => ({
        key: name,
        display:
          registered.sensors.find((one) => one.name === name)?.display ?? name,
      })),
    ];

    run = {
      running: [
        ...(plan.analysis ? [ANALYSIS_KEY] : []),
        ...(plan.describe ? [DESCRIBE_KEY] : []),
        ...plan.sense,
      ],
      started: null,
      failures: run.failures,
      diagnoses: run.diagnoses,
      ranAt: run.ranAt,
    };

    resetProgress();
    startedFrom = record?.run_id ?? null;
    ownRunId = null;
    ownEnd = null;
    scanStartedWall = wallNow();
    starting = { at: scanStartedWall };
    publish();

    let result: ScanRunResult;

    try {
      result = await ports.port.run(plan);
    } catch (error) {
      result = { status: "failed", exitCode: -1, stderr: String(error) };
    }

    await externalQueue;

    if (result.status === "attached") {
      attachedToOther = true;
      ownRunId = null;
      starting = null;

      const finished = takeOwnEnd();

      if (finished !== null) {
        await endRun(finished);

        return;
      }

      await openFromCache();

      if (ports.hasExplorer()) {
        ports.settled();
      } else {
        ports.attached();
      }

      return;
    }

    const ended = takeOwnEnd();

    if (ended !== null) {
      await endRun(ended);

      return;
    }

    liveRunId = null;
    run = { ...run, running: [], started: null };

    if (
      (result.status === "gaps" &&
        result.gaps.every((gap) => gap.id.startsWith("toolchain:"))) ||
      result.status === "stopped" ||
      result.status === "command-missing" ||
      result.status === "refused" ||
      result.status === "failed"
    ) {
      starting = null;
    }

    if (result.status === "gaps") {
      resetProgress();
      emit({ scanning: null });
      const refusal = refusedText(result.gaps);

      ports.post({ kind: "warning", text: `Scan refused - ${refusal}` });
      await openRefused(refusal);
      ports.settled();

      return;
    }

    const text = failureText(result);

    if (text !== null) {
      resetProgress();
      emit({ scanning: null });
      ports.post({
        kind: result.status === "refused" ? "warning" : "error",
        text: `Scan ${result.status === "refused" ? "refused" : "failed"} - ${text}`,
      });
      await openFromCache();
      ports.blocked(text);
      ports.settled();

      return;
    }

    if (result.status === "stopped") {
      overlay = { ...overlay, stopped: true };
      publish();

      try {
        await reload();
      } catch (error) {
        ports.post({ kind: "error", text: `Sensors failed: ${String(error)}` });
      }

      ports.settled();

      return;
    }

    if (adoptedThisScan || ports.hasExplorer()) {
      try {
        await reload();
      } catch (error) {
        ports.post({
          kind: "error",
          text: `Sensors failed: ${String(error)}`,
        });
      }
    }

    overlay = { ...overlay, done: true };
    publish();

    if (!ports.hasExplorer()) {
      await settle();
      publish();

      return;
    }

    ports.settled();
  }

  async function loadTicks() {
    const stored = await ports.port.readTicks();
    const storedTicked = stored.ticked ?? null;

    const loaded: ScanTicks = {
      describe: stored.describe,
      analysis: stored.analysis !== false,
      ticked: storedTicked ?? (stored.sensors ? null : []),
      armed: ticks.armed,
      onlyView: stored.onlyView === true,
      suites: stored.suites ?? {},
      folds: stored.folds ?? [],
    };

    ticks = loaded;
    remembered = stored.remembered;
    ticksLoaded = true;

    if (storedTicked === null) {
      return;
    }

    splitting = ports
      .registered()
      .then((registered) => {
        if (ticks !== loaded) {
          return;
        }

        const isArmed = (name: string) =>
          registered.sensors.some((one) => one.name === name && one.runsTests);

        ticks = {
          ...loaded,
          ticked: storedTicked.filter((name) => !isArmed(name)),
          armed: storedTicked.filter(isArmed),
        };
      })
      .catch(() => {});
  }

  const rescanner: Rescanner = {
    run(modules = null, planned) {
      if (own !== null) {
        return own;
      }

      activeSeen = null;

      const started = execute(modules, planned)
        .catch((error: unknown) => {
          ports.blocked(String(error));
          ports.settled();
        })
        .finally(() => {
          own = null;
          ports.progress(lastUpdate);
        });

      own = started;

      return started;
    },
    async stop() {
      if (own === null && !activityOf(ports.snapshot.run(), false).busy) {
        return;
      }

      await ports.port.stop();

      if (own !== null) {
        await own;
      }
    },
    async answerDescribe(describe) {
      if (progressNow().describeAsk === null) {
        return;
      }

      try {
        await ports.port.answerDescribe(describe);
      } catch (error) {
        ports.post({ kind: "error", text: String(error) });
      }
    },
    async refresh() {
      try {
        await reload();
      } catch (error) {
        ports.post({
          kind: "error",
          text: `Sensors failed: ${String(error)}`,
        });
      }
    },
    loadTicks,
    ticks: () => ticks,
    setTicks(next) {
      ticks = next;

      void ports.registered().then((registered) => writeTicks(registered));
    },
    runState: () => run,
    running: () => {
      const held = ports.snapshot.run();

      if (held !== null && held.id === activeSeen && held.state === "stopped") {
        return false;
      }

      return own !== null || activityOf(held, false).busy;
    },
    external: () =>
      activityOf(ports.snapshot.run(), own !== null && !attachedToOther)
        .external,
    progress: progressNow,
    runView: () => ({
      run: ports.snapshot.run(),
      progress: progressOfRecord(),
      starting,
      adoptedAtOpen,
    }),
  };

  return rescanner;
}
