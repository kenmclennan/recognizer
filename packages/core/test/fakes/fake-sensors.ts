import type {
  CommitGapsInput,
  Gap,
  ProgramGapsInput,
  RunEntry,
  SenseCall,
  Sensors,
} from "../../src/index.js";

export interface InventedSensor {
  name: string;
  runsTests: boolean;
  needs: string[];
  held: boolean;
  scoped?: boolean;
  display?: string;
  registered?: boolean;
  listed?: boolean;
}

export class FakeSensors implements Sensors {
  readonly installed = new Map<string, InventedSensor>();
  readonly suites: string[] = [];
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

  commitGaps(_input: CommitGapsInput): Gap[] {
    return [];
  }

  programGaps(input: ProgramGapsInput): Gap[] {
    return input.sensors.flatMap(({ name }) =>
      (this.installed.get(name)?.needs ?? []).map((need) => ({
        id: need,
        line: `${name} cannot run`,
        needs: [need],
        fix: {
          text: `install ${need}`,
          command: null,
          cwd: "",
          env: {},
          kind: "outside" as const,
        },
      })),
    );
  }

  readinessGaps(): Gap[] {
    return [];
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
