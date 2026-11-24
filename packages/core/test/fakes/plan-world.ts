import {
  type LineKind,
  type Measured,
  type PlanMode,
  type PlanRequest,
  type Repository,
  Responsibilities,
  type ScanPlanView,
  type ScanTicks,
} from "../../src/index.js";
import { createFakes, type Fakes, scanOver } from "./container.js";
import { cachePath } from "./fake-structure-repository.js";
import { repositoryOf } from "./repository-of.js";

export const PLAN_REPOSITORY = "/work/planned";

export function scanOf(
  files: Record<string, string>,
  withFunction: string[],
): Repository {
  return repositoryOf(files, withFunction);
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

  seedScan(repository: Repository, language = "python"): void {
    this.fakes.structure.scans.set(
      cachePath(PLAN_REPOSITORY, language),
      repository,
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
      held: false,
    });
  }

  measure(sensor: string, measured: Measured): void {
    this.fakes.findings.measured.set(`${PLAN_REPOSITORY}::${sensor}`, measured);
  }

  describeLines(kinds: Record<string, LineKind>): void {
    const { describer, responsibilities, structure } = this.fakes;
    const hashes = structure.read(PLAN_REPOSITORY).scannedHashes();
    const held = new Responsibilities();

    describer.registered = true;

    for (const [id, kind] of Object.entries(kinds)) {
      if (kind === "unknown") {
        responsibilities.invalid.set(
          PLAN_REPOSITORY,
          "responsibilities is invalid",
        );
      } else if (kind !== "missing") {
        held.set(id, {
          line: "a line",
          sourceHash: kind === "current" ? (hashes.get(id) ?? "") : "stale",
          describer: describer.command,
          version: describer.version,
        });
      }
    }

    responsibilities.write(PLAN_REPOSITORY, held);
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
