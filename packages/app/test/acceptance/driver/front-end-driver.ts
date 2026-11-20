import { NO_CHANGES } from "../../../src/footer-scan";
import { registeredOf } from "../../../src/look-support";
import {
  createRescanner,
  type Rescanner,
  type RescanPorts,
} from "../../../src/rescanner";
import type { PlannedRun, ResultsMode } from "../../../src/scan-freshness";
import {
  NO_RUN,
  type PanelInput,
  type RowSensor,
  rowSensors,
  type ScanPlan,
  scanPanel,
} from "../../../src/scan-panel-model";
import { inertScan } from "../../../src/scan-port";
import type { ShippedSensors } from "../../../src/sensor-run";
import { plainSensor } from "../../../src/shipped-fake";
import {
  afterSensorTick,
  afterSuiteTick,
  sensorTickState,
} from "../../../src/suite-ticks";

export type InstalledSensor = {
  name: string;
  runsTests: boolean;
};

export type Repository = {
  sensors: InstalledSensor[];
  suites: string[];
  describedFiles: string[];
  undescribedFiles: string[];
};

export type StartedScan = {
  senses: string[];
  describes: boolean;
  describesAll: boolean;
  describedFiles: string[];
  suitesOf(sensor: string): string[];
};

const NOW = 1_000_000;

function idOf(sensor: string): string {
  return sensor.toLowerCase();
}

function configFor(repository: Repository): string {
  const sensors = repository.sensors
    .map(({ name }) => `  ${idOf(name)}:\n    command: [sense-${idOf(name)}]\n`)
    .join("");
  const tests = repository.suites
    .map(
      (name) =>
        `  - name: ${name}\n    language: python\n    directory: ${name}\n    command: run-${name}\n    coverage:\n      path: ${name}/coverage.info\n      format: lcov\n`,
    )
    .join("");

  return `describer:\n  command: [describer, "{request}"]\n  version: v1\nsensors:\n${sensors}${tests === "" ? "" : `tests:\n${tests}`}`;
}

function installedOf(repository: Repository): ShippedSensors {
  return {
    status: "ok",
    sensors: repository.sensors.map(({ name, runsTests }) =>
      plainSensor(idOf(name), { display: name, runsTests }),
    ),
  };
}

function inertPorts(
  rows: RowSensor[],
  files: string[],
  onRun: (plan: ScanPlan) => void,
): RescanPorts<null> {
  const noop = () => {};

  return {
    port: {
      ...inertScan,
      run: async (plan) => {
        onRun(plan);

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
}

export class FrontEndDriver {
  private readonly config: string;
  private readonly installed: ShippedSensors;
  private readonly rows: RowSensor[];
  private readonly files: string[];
  private readonly undescribed: Set<string>;
  private readonly rescanner: Rescanner;
  private mode: ResultsMode = "bring";
  private held: PlannedRun | null = null;
  private started: ((plan: ScanPlan) => void) | null = null;
  private pending: Promise<void>;

  constructor(repository: Repository) {
    this.config = configFor(repository);
    this.installed = installedOf(repository);
    this.rows = rowSensors(this.config, this.installed);
    this.files = [...repository.describedFiles, ...repository.undescribedFiles];
    this.undescribed = new Set(repository.undescribedFiles);
    this.rescanner = createRescanner(
      inertPorts(this.rows, this.files, (plan) => this.started?.(plan)),
    );
    this.pending = this.rescanner.loadTicks();
  }

  tick(sensor: string) {
    this.flip(sensor, (state) => state === "off");
  }

  untick(sensor: string) {
    this.flip(sensor, (state) => state !== "off");
  }

  tickSuite(sensor: string, suite: string) {
    this.enqueue(() => {
      const row = this.row(sensor);

      this.rescanner.setTicks(
        afterSuiteTick(
          this.rescanner.ticks(),
          row.name,
          suite,
          true,
          this.suitesOf(row),
        ),
      );
    });
  }

  tickDescriptions() {
    this.enqueue(() =>
      this.rescanner.setTicks({ ...this.rescanner.ticks(), describe: true }),
    );
  }

  chooseMode(mode: "Incremental" | "Full") {
    this.enqueue(() => {
      this.mode = mode === "Full" ? "rescan" : "bring";
    });
  }

  showPlan() {
    this.enqueue(() => {
      this.held = this.plan() ?? null;
    });
  }

  async startScan(): Promise<StartedScan> {
    await this.pending;

    const planned = this.held ?? this.plan();

    this.held = null;

    const received = new Promise<ScanPlan>((resolve) => {
      this.started = resolve;
    });
    const finished = this.rescanner.run(null, planned);
    const plan = await Promise.race([received, finished.then(() => null)]);

    await finished;

    if (plan === null) {
      throw new Error("The scan ended without starting");
    }

    return this.shown(plan);
  }

  private shown(plan: ScanPlan): StartedScan {
    const display = (id: string) =>
      this.rows.find((row) => row.name === id)?.display ?? id;

    return {
      senses: plan.sense.map(display),
      describes: plan.describe,
      describesAll: plan.describeAll,
      describedFiles: plan.modules ?? [],
      suitesOf: (sensor) => plan.suites?.[this.row(sensor).name] ?? [],
    };
  }

  private enqueue(step: () => void) {
    this.pending = this.pending.then(step);
  }

  private row(sensor: string): RowSensor {
    const found = this.rows.find((one) => one.display === sensor);

    if (found === undefined) {
      throw new Error(`The panel has no sensor called ${sensor}`);
    }

    return found;
  }

  private suitesOf(row: RowSensor): string[] {
    return (row.suites ?? []).map((one) => one.name);
  }

  private flip(sensor: string, when: (state: string) => boolean) {
    this.enqueue(() => {
      const row = this.row(sensor);
      const all = this.suitesOf(row);
      const ticks = this.rescanner.ticks();

      if (when(sensorTickState(ticks, row.name, all))) {
        this.rescanner.setTicks(afterSensorTick(ticks, row.name, all));
      }
    });
  }

  private plan(): PlannedRun | undefined {
    return scanPanel(this.panelInput()).planned ?? undefined;
  }

  private panelInput(): PanelInput {
    return {
      scan: {
        origin: { branch: "main", commit: "abc1234" },
        scannedAt: NOW,
        changes: NO_CHANGES,
        scanning: null,
      },
      config: this.config,
      sensors: [{ name: "structure", status: "ran" }],
      lines: {
        modules: this.files,
        of: (id) =>
          this.undescribed.has(id)
            ? { kind: "missing" }
            : { kind: "current", line: "x" },
      },
      describedAt: null,
      ticks: this.rescanner.ticks(),
      mode: this.mode,
      run: NO_RUN,
      scanning: false,
      now: NOW,
      shipped: this.installed,
    };
  }
}
