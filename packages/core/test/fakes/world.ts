import { setWorldConstructor } from "@cucumber/cucumber";
import type {
  RunningScan,
  ScanEvent,
  ScanOutcome,
  ScanPlanView,
  ScanRequest,
  ScanStatus,
  SensorPlan,
  SensorRequest,
  SensorRow,
  SensorSelection,
} from "../../src/index.js";
import { createFakes, type Fakes, scanOver } from "./container.js";
import { PlanWorld } from "./plan-world.js";
import { repositoryOf } from "./repository-of.js";

export const REPOSITORY = "/work/repository";

export class ScanWorld {
  fakes: Fakes = createFakes();
  running: RunningScan | null = null;
  second: RunningScan | null = null;
  events: ScanEvent[] = [];
  outcome: ScanOutcome | null = null;
  secondOutcome: ScanOutcome | null = null;
  statusSeen: ScanStatus | null = null;
  confirmAbove: number | undefined;
  plans: PlanWorld = new PlanWorld();
  view: ScanPlanView | null = null;
  ticked: string[] = [];
  trial: {
    selection?: SensorSelection;
    plan?: SensorPlan;
    rows?: SensorRow[];
    refused?: string[];
    sense: null | "all" | SensorRequest[];
    suitesFile?: string;
    modulesFile?: string;
  } = { sense: null };

  addLanguage(language: string, fails = false): void {
    this.fakes.scanners.languages.set(language, {
      modules: 3,
      edges: 2,
      fails,
    });
  }

  failLanguage(language: string): void {
    const invented = this.fakes.scanners.languages.get(language);

    if (invented !== undefined) {
      invented.fails = true;
    }
  }

  cacheLanguage(language: string, commit: string): void {
    this.fakes.structure.save(
      REPOSITORY,
      language,
      repositoryOf({ f0: "", f1: "", f2: "" }, [], language),
    );
    this.fakes.scanners.cachedAt.set(language, commit);
  }

  addSensor(name: string, runsTests: boolean, held = false): void {
    this.fakes.sensors.installed.set(name, {
      name,
      runsTests,
      held,
    });
  }

  request(overrides: Partial<ScanRequest> = {}): ScanRequest {
    return {
      repository: REPOSITORY,
      mode: "incremental",
      sensors: null,
      describe: false,
      analysis: true,
      ignoreRetiredConfig: false,
      invocation: ["scan"],
      ...(this.confirmAbove === undefined
        ? {}
        : { confirmAbove: this.confirmAbove }),
      ...overrides,
    };
  }

  begin(overrides: Partial<ScanRequest> = {}): RunningScan {
    const scan = scanOver(this.fakes).start(this.request(overrides));

    this.running = scan;

    return scan;
  }

  async collect(scan: RunningScan): Promise<ScanOutcome> {
    for await (const event of scan.events) {
      this.events.push(event);
    }

    return scan.outcome;
  }

  async run(overrides: Partial<ScanRequest> = {}): Promise<void> {
    this.outcome = await this.collect(this.begin(overrides));
  }

  async readStatus(): Promise<void> {
    this.statusSeen = await scanOver(this.fakes).status(REPOSITORY);
  }

  async beginSecond(overrides: Partial<ScanRequest> = {}): Promise<void> {
    const scan = scanOver(this.fakes).start(this.request(overrides));

    this.second = scan;
    this.secondOutcome = await scan.outcome;
  }

  eventsOf<T extends ScanEvent["type"]>(
    type: T,
  ): Extract<ScanEvent, { type: T }>[] {
    return this.events.filter(
      (event): event is Extract<ScanEvent, { type: T }> => event.type === type,
    );
  }
}

setWorldConstructor(ScanWorld);
