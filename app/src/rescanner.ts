import type { ScanOrigin } from "./footer-scan";
import type { Loaded } from "./scan-loading";
import {
  NO_RUN,
  phasesFor,
  type RunState,
  type ScanTicks,
} from "./scan-panel-model";
import type { ScanPort, ScanRunResult } from "./scan-port";
import {
  foldProgress,
  footerText,
  NO_PROGRESS,
  parseScanLine,
  type ScanFooter,
  type ScanProgress,
  type ShowTarget,
  showTarget,
  stoppedProgress,
} from "./scan-progress";
import type { ScanReport } from "./scan-report";

export type Registered = {
  names: string[];
  overlays: string[];
  testing: string[];
  describer: boolean;
};

export type ProgressUpdate = {
  footer: ScanFooter | null;
  target: ShowTarget | null;
  log: string | null;
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
  adopted: (origin: ScanOrigin) => void;
  describedLine: () => void;
  progress: (update: ProgressUpdate) => void;
  settled: () => void;
  blocked: (text: string) => void;
  notify: (text: string) => void;
};

export type Rescanner = {
  run: () => Promise<void>;
  stop: () => Promise<void>;
  refresh: () => Promise<void>;
  loadTicks: () => Promise<void>;
  ticks: () => ScanTicks;
  setTicks: (next: ScanTicks) => void;
  runState: () => RunState;
  measureRunState: () => RunState;
  running: () => boolean;
  progress: () => ScanProgress;
};

const DEFAULT_TICKS: ScanTicks = {
  describe: false,
  measure: false,
  overlays: null,
  sensors: false,
  ticked: null,
  once: [],
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
  let ticks: ScanTicks = DEFAULT_TICKS;
  let remembered = false;
  let ticksLoaded = false;
  let run: RunState = NO_RUN;
  let measureRun: RunState = NO_RUN;
  let progress: ScanProgress = NO_PROGRESS;
  let current: Promise<void> = Promise.resolve();

  let lastUpdate: ProgressUpdate = { footer: null, target: null, log: null };

  function emit(update: ProgressUpdate) {
    lastUpdate = update;
    ports.progress(update);
  }

  function publish(log: string | null) {
    emit({
      footer: footerText(progress),
      target: showTarget(progress),
      log,
    });
  }

  async function writeTicks(
    names: string[],
    overlays: string[],
    testing: string[],
  ) {
    await ports.port.writeTicks({
      describe: ticks.describe,
      measure: ticks.measure,
      overlays: (ticks.overlays ?? overlays).filter(
        (name) => !testing.includes(name),
      ),
      sensors: ticks.sensors,
      ticked: ticks.ticked ?? names,
    });
    remembered = true;
  }

  async function settle(): Promise<boolean> {
    try {
      const scanned = ports.load(await ports.port.readCache());

      if (scanned.blocking !== null) {
        ports.blocked(scanned.blocking);

        return false;
      }

      const loaded = await ports.sense(scanned);
      const carried = ports.carry();
      const origin = await ports.adopt();

      ports.notify("");
      run = { ...run, failures: {} };
      measureRun = { ...measureRun, failures: {} };
      ports.adopted(origin);
      ports.replace(loaded, carried);

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

    if (loaded !== null) {
      ports.replace(loaded, ports.carry());
    }
  }

  async function handle(line: string, measure: string[], sense: string[]) {
    const event = parseScanLine(line);

    if (event === null) {
      return;
    }

    const before = progress;

    progress = foldProgress(progress, event);

    if (event.event === "phase" && event.phase === "measure") {
      measureRun = { ...measureRun, running: measure };
    }

    if (event.event === "entry" && event.phase === "measure") {
      const failures = { ...measureRun.failures };
      const ranAt = { ...measureRun.ranAt };

      if (event.outcome === "ok") {
        delete failures[event.name];
        ranAt[event.name] = Date.now();
      } else {
        failures[event.name] = event.reason ?? "failed";
      }

      measureRun = {
        running: measureRun.running.filter((name) => name !== event.name),
        failures,
        ranAt,
      };
    }

    if (event.event === "phase" && event.phase === "sense") {
      run = { ...run, running: sense };
    }

    if (event.event === "entry" && event.phase === "sense") {
      const failures = { ...run.failures };
      const ranAt = { ...run.ranAt };

      if (event.outcome === "ok") {
        delete failures[event.name];
        ranAt[event.name] = Date.now();
      } else {
        failures[event.name] = event.reason ?? "failed";
      }

      run = {
        running: run.running.filter((name) => name !== event.name),
        failures,
        ranAt,
      };
    }

    publish(null);

    if (!before.extractSettled && progress.extractSettled) {
      await settle();
      publish(null);
    }

    if (event.event === "entry" && event.phase === "describe") {
      ports.describedLine();
    }

    if (
      event.event === "entry" &&
      (event.phase === "sense" || event.phase === "measure")
    ) {
      await reload();
    }
  }

  async function execute() {
    try {
      await executeScan();
    } finally {
      ticks = { ...ticks, once: [] };
    }
  }

  async function executeScan() {
    const registered = await ports.registered();

    if (!ticksLoaded) {
      await loadTicks();
    }

    const { plan } = phasesFor(
      ticks,
      registered.names,
      registered.describer,
      registered.overlays,
      registered.testing,
    );

    if (!remembered) {
      await writeTicks(
        registered.names,
        registered.overlays,
        registered.testing,
      );
    }

    progress = NO_PROGRESS;
    publish(null);

    let queue: Promise<void> = Promise.resolve();
    const stopListening = ports.port.onLine((line) => {
      queue = queue
        .then(() => handle(line, plan.measure, plan.sense))
        .catch(() => {});
    });
    let result: ScanRunResult;

    try {
      result = await ports.port.run(plan);
    } catch (error) {
      result = { status: "failed", exitCode: -1, stderr: String(error) };
    }

    await queue;
    stopListening();
    run = { ...run, running: [] };
    measureRun = { ...measureRun, running: [] };

    const text = failureText(result);

    if (text !== null) {
      progress = NO_PROGRESS;
      emit({ footer: null, target: null, log: null });
      ports.blocked(text);
      ports.settled();

      return;
    }

    if (result.status === "stopped") {
      progress = stoppedProgress(progress);
      publish(null);
      ports.settled();

      return;
    }

    if (!progress.extractSettled) {
      progress = { ...progress, extractSettled: true };
      await settle();
    }

    if (plan.measure.length > 0) {
      await reload();
    }

    progress = { ...progress, done: true };
    publish(result.status === "finished" ? result.log : null);
    ports.settled();
  }

  async function loadTicks() {
    const stored = await ports.port.readTicks();

    ticks = {
      describe: stored.describe,
      measure: stored.measure,
      overlays: stored.overlays,
      sensors: stored.sensors,
      ticked: stored.ticked,
      once: ticks.once,
    };
    remembered = stored.remembered;
    ticksLoaded = true;
  }

  return {
    run() {
      if (busy) {
        return Promise.resolve();
      }

      busy = true;
      current = execute()
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
    async refresh() {
      if (busy) {
        return;
      }

      busy = true;

      try {
        await reload();
      } catch (error) {
        ports.notify(`Sensors failed: ${String(error)}`);
      } finally {
        busy = false;
      }
    },
    loadTicks,
    ticks: () => ticks,
    setTicks(next) {
      ticks = next;

      void ports
        .registered()
        .then(({ names, overlays, testing }) =>
          writeTicks(names, overlays, testing),
        );
    },
    runState: () => run,
    measureRunState: () => measureRun,
    running: () => busy,
    progress: () => progress,
  };
}
