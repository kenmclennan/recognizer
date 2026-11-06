import type { ScanOrigin } from "./footer-scan";
import { loadedUnchanged, sameStructure } from "./loaded-unchanged";
import type { MessageAction, MessageInput } from "./message-tray";
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
import type { ScanPort, ScanRunResult } from "./scan-port";
import {
  answeredProgress,
  foldProgress,
  NO_PROGRESS,
  parseScanLine,
  type RunRow,
  type ScanProgress,
  type ShowTarget,
  scanningText,
  stoppedProgress,
} from "./scan-progress";
import type { ScanReport } from "./scan-report";

export type Registered = Pick<RowSensor, "name" | "display" | "runsTests">[];

export type ProgressUpdate = { scanning: string | null };

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
  blocked: (text: string) => void;
  post: (input: MessageInput) => number | null;
  attach: (id: number, extra: MessageAction) => void;
  openLog: (log: string) => void;
  show: (target: ShowTarget) => void;
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
  progress: () => ScanProgress;
};

const DEFAULT_TICKS: ScanTicks = {
  describe: false,
  ticked: [],
  once: [],
  onlyView: false,
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

  function emit(update: ProgressUpdate) {
    lastUpdate = update;
    ports.progress(update);
  }

  function publish() {
    const text = scanningText(rows, run.started, progress);

    emit({
      scanning: text === null || heading === null ? text : `${heading} ${text}`,
    });
  }

  async function writeTicks(registered: Registered) {
    const plain = registered
      .filter(({ runsTests }) => !runsTests)
      .map(({ name }) => name);

    await ports.port.writeTicks({
      describe: ticks.describe,
      ticked: (ticks.ticked ?? plain).filter((name) => plain.includes(name)),
      onlyView: ticks.onlyView,
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
      const scanned = ports.load(await ports.port.readCache());

      if (scanned.blocking !== null) {
        ports.blocked(scanned.blocking);

        return false;
      }

      const loaded = await ports.sense(scanned);
      const origin = await ports.adopt();

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

  function finished(name: string, ok: boolean, reason: string) {
    const failures = { ...run.failures };

    if (ok) {
      delete failures[name];
    } else {
      failures[name] = reason;
    }

    const running = run.running.filter((one) => one !== name);
    const next = running.find((one) => one !== DESCRIBE_KEY) ?? null;

    run = {
      running,
      started: run.started === name ? next : run.started,
      failures,
      ranAt: { ...run.ranAt, [name]: Date.now() },
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

  async function handle(line: string) {
    const event = parseScanLine(line);

    if (event === null) {
      return;
    }

    const before = progress;

    progress = foldProgress(progress, event);

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
      finished(event.name, event.outcome === "ok", event.reason ?? "failed");

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

  async function execute(modules: string[] | null, planned?: PlannedRun) {
    try {
      await executeScan(modules, planned);
    } finally {
      ticks = { ...ticks, once: [] };
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
      ranAt: run.ranAt,
    };

    progress = NO_PROGRESS;
    publish();

    let queue: Promise<void> = Promise.resolve();
    const stopListening = ports.port.onLine((line) => {
      queue = queue.then(() => handle(line)).catch(() => {});
    });
    let result: ScanRunResult;

    try {
      result = await ports.port.run(plan);
    } catch (error) {
      result = { status: "failed", exitCode: -1, stderr: String(error) };
    }

    await queue;
    stopListening();
    run = { ...run, running: [], started: null };

    const text = failureText(result);

    if (text !== null) {
      progress = NO_PROGRESS;
      emit({ scanning: null });
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

    if (!progress.extractSettled) {
      progress = { ...progress, extractSettled: true };
      await settle();
    }

    progress = { ...progress, done: true };
    postDescribed();
    publish();

    if (result.status === "finished" && result.log !== null) {
      const { log } = result;
      const open: MessageAction = {
        label: "Open log",
        run: () => ports.openLog(log),
      };

      for (const id of failureIds) {
        ports.attach(id, open);
      }
    }

    ports.settled();
  }

  async function loadTicks() {
    const stored = await ports.port.readTicks();

    ticks = {
      describe: stored.describe,
      ticked: stored.ticked ?? (stored.sensors ? null : []),
      once: ticks.once,
      onlyView: stored.onlyView === true,
    };
    remembered = stored.remembered;
    ticksLoaded = true;
  }

  return {
    run(modules = null, planned) {
      if (busy) {
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
      if (!busy) {
        return;
      }

      await ports.port.stop();
      await current;
    },
    async answerDescribe(describe) {
      if (progress.describeAsk === null) {
        return;
      }

      progress = answeredProgress(progress, describe);
      publish();

      try {
        await ports.port.answerDescribe(describe);
      } catch (error) {
        ports.post({ kind: "error", text: String(error) });
      }
    },
    async refresh() {
      if (busy) {
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
    running: () => busy,
    progress: () => progress,
  };
}
