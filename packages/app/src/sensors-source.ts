import { invoke } from "@tauri-apps/api/core";
import type { RunRecordFiles } from "./refusal-record";
import type { RepositoryStateHolder } from "./repository-state-holder";
import { installedSensorsOf, storedResultsOf } from "./repository-state-model";
import type { RepositoryStatePort } from "./repository-state-port";
import type { PlannedWork } from "./scan-estimate";
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

export function createSensorsSource(deps: SensorsSourceDeps): SensorsPort {
  return {
    readResults: async () => {
      const [state, texts] = await Promise.all([
        deps.state.latest(),
        deps.results.readResults(),
      ]);

      return storedResultsOf(state, texts);
    },
    readRunRecords: () => invoke<RunRecordFiles>("read_run_records"),
    readTestsHash: async (known) =>
      coreReply<string | null>(
        await invoke<unknown>("core_call", {
          op: "tests.hash",
          args: { known },
        }),
      ),
    clearResults: (name) => deps.results.clearResults(name),
    readInputs: () => invoke<SensorInputs>("read_sensor_inputs"),
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
