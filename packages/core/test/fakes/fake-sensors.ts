import type {
  RunEntry,
  SenseCall,
  SensorReport,
  Sensors,
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
}

export class FakeSensors implements Sensors {
  readonly installed = new Map<string, InventedSensor>();
  readonly suites: string[] = [];
  readonly unavailable = new Set<string>();
  readonly reports: SensorReport[] = [];
  readonly ran: { name: string; command: string[] }[] = [];
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
    for (const sensor of call.selected) {
      call.onStart(sensor.name);
      this.log.push(`sense:${sensor.name}`);
      this.ran.push({ name: sensor.name, command: sensor.command });

      if (this.installed.get(sensor.name)?.held) {
        this.signalStarted();
        await this.releasing;
      }

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
}
