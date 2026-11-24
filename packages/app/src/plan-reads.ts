import type {
  LocatedDescriber,
  Repository,
  Responsibility,
} from "@recognizer/core";
import type {
  LineKind,
  Measured,
  PlanRequest,
  ScanPlanView,
  SensorRow,
} from "./scan-freshness";

export type { PlanRequest, ScanPlanView, SensorRow };

export type LoadedPlanData = {
  scans: Repository;
  measured: Record<string, Measured | null>;
  tests: string | null;
  describerRegistered: boolean;
  lineKinds: (id: string) => LineKind;
  sensors: SensorRow[];
};

export function planReads(data: LoadedPlanData) {
  const modules = data.scans.files.map(({ path }) => path);
  const hashes = data.scans.scannedHashes();
  const kinds = modules.map((id) => data.lineKinds(id));
  const describer = ["describer"];
  const located: LocatedDescriber = data.describerRegistered
    ? { describer: { describerRef: true, command: describer, version: "v" } }
    : { describer: null };

  return {
    structure: { read: () => data.scans },
    describer: { locate: () => located },
    responsibilities: {
      read: () => {
        if (kinds.includes("unknown")) {
          throw Object.assign(new Error("responsibilities are unreadable"), {
            name: "InvalidRequest",
          });
        }

        return {
          get: (id: string): Responsibility | undefined => {
            const kind = data.lineKinds(id);

            return kind === "missing"
              ? undefined
              : {
                  line: "",
                  sourceHash:
                    kind === "current" ? (hashes.get(id) ?? "") : "stale",
                  describer,
                  version: "v",
                };
          },
        };
      },
    },
    findings: {
      measuredOf: (_root: string, sensor: string) =>
        data.measured[sensor] ?? null,
    },
    tests: { current: () => data.tests },
    sensors: { registered: () => data.sensors },
  };
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
