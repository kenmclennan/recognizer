import type {
  LineKind,
  Measured,
  PlanMode,
  PlanRequest,
  ScanFacts,
  ScanPlanView,
  ScanTicks,
} from "../../src/index.js";
import { createFakes, type Fakes, scanOver } from "./container.js";
import { cachePath } from "./fake-store.js";

export const PLAN_REPOSITORY = "/work/planned";

export function scanOf(
  files: Record<string, string>,
  withFunction: string[],
): ScanFacts {
  return {
    modules: Object.keys(files).map((id) => ({
      id,
      members: withFunction.includes(id) ? [{ kind: "function" }] : [],
    })),
    files: Object.entries(files).map(([path, hash]) => ({ path, hash })),
  };
}

export function ticksOf(over: Partial<ScanTicks> = {}): ScanTicks {
  return {
    describe: false,
    analysis: true,
    ticked: [],
    armed: [],
    onlyView: false,
    suites: {},
    folds: [],
    ...over,
  };
}

export class PlanWorld {
  readonly fakes: Fakes = createFakes();

  seedScan(scan: ScanFacts, language = "python"): void {
    this.fakes.store.files.set(
      cachePath(PLAN_REPOSITORY, language),
      JSON.stringify(scan),
    );
  }

  addSensor(
    name: string,
    options: { runsTests?: boolean; scoped?: boolean; display?: string } = {},
  ): void {
    this.fakes.sensors.installed.set(name, {
      name,
      runsTests: options.runsTests ?? false,
      scoped: options.scoped ?? false,
      ...(options.display === undefined ? {} : { display: options.display }),
      needs: [],
      held: false,
    });
  }

  measure(sensor: string, measured: Measured): void {
    this.fakes.store.measured.set(`${PLAN_REPOSITORY}::${sensor}`, measured);
  }

  describeLines(kinds: Record<string, LineKind>): void {
    this.fakes.store.kinds.set(PLAN_REPOSITORY, { registered: true, kinds });
  }

  request(over: Partial<PlanRequest> & { mode?: PlanMode } = {}): PlanRequest {
    return {
      repository: PLAN_REPOSITORY,
      mode: "bring",
      ticks: ticksOf(),
      scope: null,
      changed: [],
      ...over,
    };
  }

  plan(over: Partial<PlanRequest> = {}): Promise<ScanPlanView> {
    return scanOver(this.fakes).plan(this.request(over));
  }
}
