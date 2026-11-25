import { PolicyRule, type PolicyRuleFields } from "@recognizer/core";
import { invoke } from "@tauri-apps/api/core";
import type { PlannedWork } from "./estimate-text";
import type { RepositoryStateHolder } from "./repository-state-holder";
import { installedSensorsOf, storedResultsOf } from "./repository-state-model";
import type { RepositoryStatePort } from "./repository-state-port";
import { coreReply } from "./scan-source";
import type {
  DescriberInEffect,
  SensorInputs,
  SensorsPort,
  WorkRequest,
} from "./sensor-run";

export type SensorsSourceDeps = {
  state: RepositoryStateHolder;
  results: RepositoryStatePort;
};

type WireInputs = Omit<SensorInputs, "policy"> & {
  policy: PolicyRuleFields[] | null;
};

export function createSensorsSource(deps: SensorsSourceDeps): SensorsPort {
  return {
    readResults: async (tests) => {
      return storedResultsOf(await deps.results.readResults(tests));
    },
    readTestsHash: async (known) =>
      coreReply<string | null>(
        await invoke<unknown>("core_call", {
          op: "tests.hash",
          args: { known },
        }),
      ),
    clearResults: (name) => deps.results.clearResults(name),
    inputs: async () => {
      const read = coreReply<WireInputs>(
        await invoke<unknown>("core_call", { op: "inputs.read", args: {} }),
      );

      return {
        ...read,
        policy:
          read.policy === null
            ? null
            : read.policy.map((rule) => PolicyRule.of(rule)),
      };
    },
    sensorList: async () => installedSensorsOf(await deps.state.latest()),
    describer: () => invoke<DescriberInEffect>("describer_in_effect"),
    plannedWork: async ({ sensor, modules, suites }: WorkRequest) =>
      coreReply<PlannedWork | null>(
        await invoke<unknown>("core_call", {
          op: "sensor.work",
          args: { sensor, modules, suites },
        }),
      ),
  };
}
