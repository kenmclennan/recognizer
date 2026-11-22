import {
  createPlanner,
  type LineKind,
  type Measured,
  type PlanRequest,
  type ScanFacts,
  type ScanPlanView,
  type SensorRow,
} from "./scan-freshness";

export type { PlanRequest, ScanFacts, ScanPlanView, SensorRow };

export type LoadedPlanData = {
  scans: ScanFacts[];
  measured: Record<string, Measured | null>;
  tests: string | null;
  describerRegistered: boolean;
  lineKinds: (id: string) => LineKind;
  sensors: SensorRow[];
};

export function planReads(data: LoadedPlanData) {
  const modules = data.scans.flatMap((scan) =>
    scan.modules.map(({ id }) => id),
  );
  const lines = {
    registered: data.describerRegistered,
    kinds: Object.fromEntries(modules.map((id) => [id, data.lineKinds(id)])),
  };

  return {
    store: {
      cachedScans: () => data.scans,
      measuredOf: (_root: string, sensor: string) =>
        data.measured[sensor] ?? null,
      testsDigest: () => data.tests,
      responsibilityKinds: () => lines,
    },
    sensors: { registered: () => data.sensors },
  };
}

export function planThrough(data: LoadedPlanData) {
  return createPlanner(planReads(data));
}

export function latestPlanOnly(
  ask: (request: PlanRequest) => Promise<ScanPlanView>,
): (request: PlanRequest) => Promise<ScanPlanView | null> {
  let latest = 0;

  return async (request) => {
    latest += 1;

    const mine = latest;
    const view = await ask(request);

    return mine === latest ? view : null;
  };
}
