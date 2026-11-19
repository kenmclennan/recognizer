import { NO_CHANGES } from "../../src/footer-scan";
import { registeredOf } from "../../src/look-support";
import { createRescanner, type RescanPorts } from "../../src/rescanner";
import type { ResultsMode } from "../../src/scan-freshness";
import {
  NO_RUN,
  type PanelInput,
  rowSensors,
  type ScanPlan,
  type ScanTicks,
  scanPanel,
} from "../../src/scan-panel-model";
import { inertScan } from "../../src/scan-port";
import { plainSensor } from "../../src/shipped-fake";
import {
  afterSensorTick,
  afterSuiteTick,
  sensorTickState,
} from "../../src/suite-ticks";

export type PanelDriver = {
  tick(sensor: string): void;
  untick(sensor: string): void;
  tickSuite(sensor: string, suite: string): void;
  tickDescriptions(on: boolean): void;
  chooseMode(mode: "Incremental" | "Full"): void;
  showPlan(): void;
  startScan(): Promise<ScanPlan>;
};

export type Repository = {
  suites: string[];
  describedFiles: string[];
  undescribedFiles: string[];
};

const NOW = 1_000_000;

function configFor(suites: string[]): string {
  const tests = suites
    .map(
      (name) =>
        `  - name: ${name}\n    language: python\n    directory: ${name}\n    command: run-${name}\n    coverage:\n      path: ${name}/coverage.info\n      format: lcov\n`,
    )
    .join("");

  return `describer:\n  command: [describer, "{request}"]\n  version: v1\nsensors:\n  crap: {}\n  mutation: {}\n${suites.length === 0 ? "" : `tests:\n${tests}`}`;
}

const SHIPPED = {
  status: "ok" as const,
  sensors: [
    plainSensor("mutation", {
      display: "Mutation",
      runsTests: true,
      scoped: true,
    }),
    plainSensor("crap", { display: "C.R.A.P.", runsTests: true }),
  ],
};

export function frontEndDriver(repository: Repository): PanelDriver {
  const config = configFor(repository.suites);
  const rows = rowSensors(config, SHIPPED);
  const files = [...repository.describedFiles, ...repository.undescribedFiles];
  const undescribed = new Set(repository.undescribedFiles);
  let mode: ResultsMode = "bring";
  let held: ReturnType<typeof scanPanel>["planned"] = null;
  let started: ((plan: ScanPlan) => void) | null = null;

  const noop = () => {};
  const ports: RescanPorts<null> = {
    port: {
      ...inertScan,
      run: async (plan) => {
        started?.(plan);

        return { status: "finished", exitCode: 0 };
      },
    },
    registered: async () => registeredOf(rows),
    load: () => ({
      modules: files,
      scans: [],
      policy: null,
      baseline: null,
      notices: [],
      blocking: null,
      findings: [],
      sensors: [],
    }),
    sense: async (loaded) => loaded,
    resense: async () => null,
    adopt: async () => ({ branch: "main", commit: "abc1234" }),
    carry: () => null,
    replace: noop,
    update: () => false,
    adopted: noop,
    describedLine: noop,
    progress: noop,
    settled: noop,
    attached: noop,
    hasExplorer: () => false,
    blocked: noop,
    post: () => null,
    attach: noop,
    openLog: noop,
    show: noop,
  };
  const rescanner = createRescanner(ports);
  let pending: Promise<void> = rescanner.loadTicks();

  function enqueue(step: () => void) {
    pending = pending.then(step);
  }

  function row(name: string) {
    const found = rows.find((one) => one.display === name);

    if (found === undefined) {
      throw new Error(`The panel has no sensor called ${name}`);
    }

    return found;
  }

  function suitesOf(name: string): string[] {
    return (row(name).suites ?? []).map((one) => one.name);
  }

  function setTicks(next: ScanTicks) {
    rescanner.setTicks(next);
  }

  function panelInput(): PanelInput {
    return {
      scan: {
        origin: { branch: "main", commit: "abc1234" },
        scannedAt: NOW,
        changes: NO_CHANGES,
        scanning: null,
      },
      config,
      sensors: [{ name: "structure", status: "ran" }],
      lines: {
        modules: files,
        of: (id) =>
          undescribed.has(id)
            ? { kind: "missing" }
            : { kind: "current", line: "x" },
      },
      describedAt: null,
      ticks: rescanner.ticks(),
      mode,
      run: NO_RUN,
      scanning: false,
      now: NOW,
      shipped: SHIPPED,
    };
  }

  function plan() {
    return scanPanel(panelInput()).planned ?? undefined;
  }

  function flip(sensor: string, whenState: (state: string) => boolean) {
    enqueue(() => {
      const target = row(sensor);
      const all = suitesOf(sensor);
      const state = sensorTickState(rescanner.ticks(), target.name, all);

      if (whenState(state)) {
        setTicks(afterSensorTick(rescanner.ticks(), target.name, all));
      }
    });
  }

  return {
    tick(sensor) {
      flip(sensor, (state) => state === "off");
    },
    untick(sensor) {
      flip(sensor, (state) => state !== "off");
    },
    tickSuite(sensor, suite) {
      enqueue(() =>
        setTicks(
          afterSuiteTick(
            rescanner.ticks(),
            row(sensor).name,
            suite,
            true,
            suitesOf(sensor),
          ),
        ),
      );
    },
    tickDescriptions(on) {
      enqueue(() => setTicks({ ...rescanner.ticks(), describe: on }));
    },
    chooseMode(next) {
      enqueue(() => {
        mode = next === "Full" ? "rescan" : "bring";
      });
    },
    showPlan() {
      enqueue(() => {
        held = plan() ?? null;
      });
    },
    async startScan() {
      await pending;

      const planned = held ?? plan();

      held = null;

      const received = new Promise<ScanPlan>((resolve) => {
        started = resolve;
      });
      const finished = rescanner.run(null, planned);
      const outcome = await Promise.race([received, finished.then(() => null)]);

      await finished;

      if (outcome === null) {
        throw new Error("The scan ended without starting");
      }

      return outcome;
    },
  };
}
