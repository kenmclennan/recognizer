import {
  type DeclaredMetric,
  type FindingsRepository,
  type PluginEvent,
  ResultAccumulator,
  type RunEntry,
  type SenseCall,
  type SensorReport,
  type Sensors,
} from "../../src/index.js";

export interface InventedSensor {
  name: string;
  runsTests: boolean;
  held: boolean;
  scoped?: boolean;
  display?: string;
  registered?: boolean;
  listed?: boolean;
  unreadable?: string;
  manifestCommand?: string[];
  runCommand?: string[];
  withoutManifest?: boolean;
}

export interface ScriptedReport {
  events: PluginEvent[];
  metrics?: DeclaredMetric[];
}

export class FakeSensors implements Sensors {
  readonly scripted = new Map<string, ScriptedReport>();
  findings: FindingsRepository | null = null;
  readonly installed = new Map<string, InventedSensor>();
  readonly suites: string[] = [];
  readonly unavailable = new Set<string>();
  readonly reports: SensorReport[] = [];
  readonly ran: { name: string; command: string[] }[] = [];
  readonly calls: { scope: SenseCall["scope"]; modified: boolean | null }[] =
    [];
  started: Promise<void>;
  private signalStarted: () => void = () => {};
  private release: () => void = () => {};
  private readonly releasing: Promise<void>;

  constructor(private readonly log: string[]) {
    this.started = new Promise((resolve) => {
      this.signalStarted = resolve;
    });
    this.releasing = new Promise((resolve) => {
      this.release = resolve;
    });
  }

  releaseHeld(): void {
    this.release();
  }

  probe(program: string): { started: boolean; status: number | null } {
    return [...this.unavailable].some((name) => program.endsWith(name))
      ? { started: false, status: null }
      : { started: true, status: 0 };
  }

  readinessReports(): SensorReport[] {
    return this.reports;
  }

  async run(call: SenseCall): Promise<void> {
    this.calls.push({ scope: call.scope, modified: call.modified });

    for (const sensor of call.selected) {
      call.onStart(sensor.name);
      this.log.push(`sense:${sensor.name}`);
      this.ran.push({ name: sensor.name, command: sensor.command });

      if (this.installed.get(sensor.name)?.held) {
        this.signalStarted();
        await this.releasing;
      }

      this.report(call, sensor.name);

      const entry: RunEntry = {
        name: sensor.name,
        command: sensor.command,
        status: 0,
        outcome: "ok",
        duration_ms: 1,
        stderr: "",
      };

      call.onEntry(entry);
    }
  }

  private report(call: SenseCall, name: string): void {
    const script = this.scripted.get(name);

    if (script === undefined || this.findings === null) {
      return;
    }

    const accumulator = new ResultAccumulator({
      name,
      version: "1",
      metrics: script.metrics ?? [],
      commit: call.commit,
      scope: call.scope,
    });

    for (const event of script.events) {
      try {
        accumulator.take(event);
      } catch {}
    }

    const { document, overlay } = accumulator.complete({
      modified: call.modified ?? true,
    });

    this.findings.stage(
      call.root,
      call.scope,
      {
        sensor: document.sensor,
        commit: document.commit,
        modified: document.modified,
        settings: document.settings,
        findings: [],
        inputs: (document.inputs as Record<string, string> | undefined) ?? {},
      },
      overlay,
    );
    this.findings.settle(call.root, call.scope, name, "complete");
  }
}
