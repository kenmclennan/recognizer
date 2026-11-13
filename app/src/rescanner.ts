import {
  type Diagnosis,
  idlePhases,
  nothingRanText,
  type ScanRunRecord,
} from "recognizer";
import type { ScanOrigin } from "./footer-scan";
import { loadedUnchanged, sameStructure } from "./loaded-unchanged";
import type { MessageAction, MessageInput } from "./message-tray";
import { runLogPath } from "./run-log-path";
import type { PlannedRun } from "./scan-freshness";
import type { Loaded } from "./scan-loading";
import {
  DESCRIBE_KEY,
  NO_RUN,
  phasesFor,
  type RowSensor,
  type RunState,
  type ScanTicks,
} from "./scan-panel-model";
import type { RunEvent, ScanPort, ScanRunResult } from "./scan-port";
import {
  NO_PROGRESS,
  parseScanLine,
  type RunRow,
  type ScanProgress,
  type ShowTarget,
  scanningText,
  stoppedProgress,
} from "./scan-progress";
import type { ScanReport } from "./scan-report";
import { foldRunLine, isActive, type RunInput } from "./scan-run-model";

export type Registered = Pick<RowSensor, "name" | "display" | "runsTests">[];

export type ProgressUpdate = {
  scanning: string | null;
};

export type RescanPorts<Carried> = {
  port: ScanPort;
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
  hasExplorer: () => boolean;
  blocked: (text: string) => void;
  post: (input: MessageInput) => number | null;
  attach: (id: number, extra: MessageAction) => void;
  openLog: (log: string) => void;
  show: (target: ShowTarget) => void;
  now?: () => number;
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
  progress: () => ScanProgress;
  runView: () => RunInput;
};

const DEFAULT_TICKS: ScanTicks = {
  describe: false,
  ticked: [],
  once: [],
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

export function createRescanner<Carried>(
  ports: RescanPorts<Carried>,
): Rescanner {
  let busy = false;
  let applied: Loaded | null = null;
  let ticks: ScanTicks = DEFAULT_TICKS;
  let remembered = false;
  let ticksLoaded = false;
  let run: RunState = NO_RUN;
  let progress: ScanProgress = NO_PROGRESS;
  let current: Promise<void> = Promise.resolve();

  let rows: RunRow[] = [];
  let heading: string | null = null;
  let failureIds: number[] = [];
  let lastUpdate: ProgressUpdate = { scanning: null };
  let record: ScanRunRecord | null = null;
  let begunRunId: string | null = null;
  let liveRunId: string | null = null;
  let endedRunId: string | null = null;
  let ownEnd: ScanRunRecord | null = null;
  let starting: { at: number } | null = null;
  let startedFrom: string | null = null;
  let ownRunId: string | null = null;
  let adoptedAtOpen: string | null = null;
  let seenFirst = false;
  let keepOnce = false;
  let adoptedThisScan = false;
  const now = ports.now ?? Date.now;
  let externalQueue: Promise<void> = Promise.resolve();

  function emit(update: { scanning: string | null }) {
    lastUpdate = { ...update };
    ports.progress(lastUpdate);
  }

  function publish() {
    const text = scanningText(rows, run.started, progress);

    emit({
      scanning: text === null || heading === null ? text : `${heading} ${text}`,
    });
  }

  function names(display: string[], describe: boolean): string {
    return [...display, ...(describe ? ["describe"] : [])].join(", ");
  }

  async function writeTicks(registered: Registered) {
    const plain = registered
      .filter(({ runsTests }) => !runsTests)
      .map(({ name }) => name);

    await ports.port.writeTicks({
      describe: ticks.describe,
      ticked: (ticks.ticked ?? plain).filter((name) => plain.includes(name)),
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
    const entries = progress.describe?.entries ?? [];

    if (progress.describe === null) {
      return;
    }

    const failed = entries.filter((entry) => entry.outcome === "failed");
    const first = failed[0];

    const id = ports.post({
      kind: "info",
      text: `Describe wrote ${entries.length - failed.length} lines, ${failed.length} modules failed.`,
      ...(first === undefined
        ? {}
        : {
            action: {
              label: "Show" as const,
              run: () =>
                ports.show({
                  kind: "module",
                  id: first.name,
                  reason: first.reason ?? "failed",
                }),
            },
          }),
    });

    if (first !== undefined) {
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

  function settleDescribe() {
    if (!run.running.includes(DESCRIBE_KEY)) {
      return;
    }

    const entries = progress.describe?.entries ?? [];

    if (
      entries.length > 0 &&
      entries.every((one) => one.outcome === "failed")
    ) {
      finished(DESCRIBE_KEY, false, entries[0]?.reason ?? "failed");
    } else {
      finished(DESCRIBE_KEY, true, "");
    }
  }

  async function applyLine(line: string) {
    if (!busy && liveRunId === null) {
      return;
    }

    const event = parseScanLine(line);

    if (event === null) {
      return;
    }

    const before = progress;

    progress = foldRunLine(progress, event, now());

    if (event.event === "phase" && event.phase === "describe") {
      run = { ...run, started: DESCRIBE_KEY };

      if (event.total === 0) {
        settleDescribe();
      }
    }

    if (event.event === "phase" && event.phase === "sense") {
      settleDescribe();
      run = {
        ...run,
        started: run.running.find((one) => one !== DESCRIBE_KEY) ?? null,
      };
    }

    if (event.event === "start") {
      run = { ...run, started: event.name };
    }

    if (event.event === "entry" && event.phase === "describe") {
      const phase = progress.describe;

      if (phase !== null && phase.entries.length >= phase.total) {
        settleDescribe();
      }
    }

    if (event.event === "entry" && event.phase === "sense") {
      if (event.outcome === "stopped") {
        settleStopped(event.name);
      } else {
        finished(
          event.name,
          event.outcome === "ok",
          event.reason ?? "failed",
          event.diagnosis ?? null,
        );
      }

      if (event.outcome === "failed") {
        postFailure(event.name, event.reason ?? "failed");
      }
    }

    if (
      event.event === "entry" &&
      event.phase === "extract" &&
      event.outcome === "failed"
    ) {
      remember(
        ports.post({
          kind: "error",
          text: `${event.name} failed: ${event.reason ?? "failed"}`,
        }),
      );
    }

    if (event.event === "summary") {
      settleDescribe();
    }

    publish();

    if (!before.extractSettled && progress.extractSettled) {
      await settle();
      publish();
    }

    if (event.event === "entry" && event.phase === "describe") {
      ports.describedLine();
    }

    if (event.event === "entry" && event.phase === "sense") {
      await reload();
    }
  }

  async function beginRun(scan: ScanRunRecord) {
    const registered = await ports.registered();
    const display = (name: string) =>
      registered.find((one) => one.name === name)?.display ?? name;

    begunRunId = scan.run_id;
    liveRunId = scan.run_id;
    adoptedThisScan = busy ? adoptedThisScan : false;
    failureIds = [];
    rows = [
      ...(scan.describe
        ? [{ key: DESCRIBE_KEY, display: "Descriptions" }]
        : []),
      ...scan.sensors.map((name) => ({ key: name, display: display(name) })),
    ];
    progress = NO_PROGRESS;
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
    progress = { ...progress, describeAsk: null };
    starting = null;

    if (scan.phase === "refused") {
      keepOnce = keepOnce || busy;
      const text = refusedText(scan.gaps);

      ports.post({ kind: "warning", text: `Scan refused - ${text}` });
      progress = { ...progress, done: true };
      publish();
      await openRefused(text);
      ports.settled();

      return;
    }

    if (scan.phase !== "finished" && scan.phase !== "failed") {
      progress = stoppedProgress(progress);
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

      progress = NO_PROGRESS;
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

    if (!progress.extractSettled) {
      progress = { ...progress, extractSettled: true };
      await settle();
    }

    progress = { ...progress, done: true };
    postDescribed();
    publish();

    if (progress.log !== null) {
      const path = runLogPath(progress.log);
      const open: MessageAction = {
        label: "Open log",
        run: () => ports.openLog(path),
      };

      for (const id of failureIds) {
        ports.attach(id, open);
      }
    }

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
    progress = NO_PROGRESS;
    emit({ scanning: null });

    try {
      await settle();
    } catch (error) {
      ports.post({ kind: "error", text: String(error) });
    }
  }

  async function takeRecord(next: ScanRunRecord | null) {
    if (next === null) {
      record = null;
      seenFirst = false;
      adoptedAtOpen = null;

      if (liveRunId !== null && !busy) {
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

    if (starting !== null && next.run_id !== startedFrom) {
      starting = null;
    }

    if (busy && next.run_id !== startedFrom) {
      ownRunId = next.run_id;
    }

    record = next;

    const own = busy && next.run_id === ownRunId;

    if (isActive(next)) {
      if (begunRunId !== next.run_id) {
        await beginRun(next);
      }

      return;
    }

    if (own) {
      ownEnd = next;
    } else if (liveRunId === next.run_id) {
      await endRun(next);
    }
  }

  function onRun(event: RunEvent) {
    externalQueue = externalQueue
      .then(async () => {
        if (event.kind === "line") {
          await applyLine(event.line);
        } else {
          await takeRecord(event.run);
        }

        ports.progress(lastUpdate);
      })
      .catch(() => {});
  }

  ports.port.onRun(onRun);

  async function execute(modules: string[] | null, planned?: PlannedRun) {
    try {
      await executeScan(modules, planned);
    } finally {
      ticks = keepOnce ? ticks : { ...ticks, once: [] };
      keepOnce = false;
      heading = null;
    }
  }

  async function executeScan(modules: string[] | null, planned?: PlannedRun) {
    const registered = await ports.registered();

    if (!ticksLoaded) {
      await loadTicks();
    }

    const { plan: base } = phasesFor(ticks, registered);
    const plan = planned?.plan ?? {
      ...base,
      modules:
        modules !== null && (base.describe || base.sense.length > 0)
          ? modules
          : null,
    };

    heading = planned?.progress ?? null;

    if (!remembered) {
      await writeTicks(registered);
    }

    failureIds = [];
    adoptedThisScan = false;
    rows = [
      ...(plan.describe
        ? [{ key: DESCRIBE_KEY, display: "Descriptions" }]
        : []),
      ...plan.sense.map((name) => ({
        key: name,
        display: registered.find((one) => one.name === name)?.display ?? name,
      })),
    ];

    run = {
      running: [...(plan.describe ? [DESCRIBE_KEY] : []), ...plan.sense],
      started: null,
      failures: run.failures,
      diagnoses: run.diagnoses,
      ranAt: run.ranAt,
    };

    progress = {
      ...NO_PROGRESS,
      timing: { ...NO_PROGRESS.timing, frozen: planned?.frozen ?? null },
    };
    startedFrom = record?.run_id ?? null;
    ownRunId = null;
    ownEnd = null;
    starting = { at: now() };
    publish();

    let result: ScanRunResult;

    try {
      result = await ports.port.run(plan);
    } catch (error) {
      result = { status: "failed", exitCode: -1, stderr: String(error) };
    }

    await externalQueue;

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
      keepOnce = true;
      progress = NO_PROGRESS;
      emit({ scanning: null });
      const refusal = refusedText(result.gaps);

      ports.post({ kind: "warning", text: `Scan refused - ${refusal}` });
      await openRefused(refusal);
      ports.settled();

      return;
    }

    const text = failureText(result);

    if (text !== null) {
      progress = NO_PROGRESS;
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
      progress = stoppedProgress(progress);
      publish();

      try {
        await reload();
      } catch (error) {
        ports.post({ kind: "error", text: `Sensors failed: ${String(error)}` });
      }

      ports.settled();

      return;
    }

    progress = { ...progress, done: true };
    publish();
    ports.settled();
  }

  async function loadTicks() {
    const stored = await ports.port.readTicks();

    ticks = {
      describe: stored.describe,
      ticked: stored.ticked ?? (stored.sensors ? null : []),
      once: ticks.once,
      onlyView: stored.onlyView === true,
      suites: stored.suites ?? {},
      folds: stored.folds ?? [],
    };
    remembered = stored.remembered;
    ticksLoaded = true;
  }

  return {
    run(modules = null, planned) {
      if (busy || isActive(record)) {
        return Promise.resolve();
      }

      busy = true;
      current = execute(modules, planned)
        .catch((error: unknown) => {
          ports.blocked(String(error));
          ports.settled();
        })
        .finally(() => {
          busy = false;
          ports.progress(lastUpdate);
        });

      return current;
    },
    async stop() {
      if (!busy && !isActive(record)) {
        return;
      }

      await ports.port.stop();

      if (busy) {
        await current;
      }
    },
    async answerDescribe(describe) {
      if (progress.describeAsk === null) {
        return;
      }

      try {
        await ports.port.answerDescribe(describe);
      } catch (error) {
        ports.post({ kind: "error", text: String(error) });
      }
    },
    async refresh() {
      if (busy || isActive(record)) {
        return;
      }

      busy = true;

      try {
        await reload();
      } catch (error) {
        ports.post({ kind: "error", text: `Sensors failed: ${String(error)}` });
      } finally {
        busy = false;
      }
    },
    loadTicks,
    ticks: () => ticks,
    setTicks(next) {
      ticks = next;

      void ports.registered().then((registered) => writeTicks(registered));
    },
    runState: () => run,
    running: () => busy || isActive(record),
    external: () => isActive(record) && !busy,
    progress: () => progress,
    runView: () => ({
      record,
      progress,
      starting,
      adoptedAtOpen,
    }),
  };
}
