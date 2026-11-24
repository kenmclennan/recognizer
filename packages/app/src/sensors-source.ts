import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { RunRecordFiles } from "./refusal-record";
import type { PlannedWork } from "./scan-estimate";
import { coreReply } from "./scan-source";
import type {
  DescriberInEffect,
  FindingsFiles,
  OverlayFiles,
  SensorInputs,
  SensorsPort,
  ShippedSensors,
  WorkRequest,
} from "./sensor-run";

export const sensorsSource: SensorsPort = {
  readFindings: () => invoke<FindingsFiles>("read_findings"),
  readOverlays: () => invoke<OverlayFiles>("read_overlays"),
  readRunRecords: () => invoke<RunRecordFiles>("read_run_records"),
  readTestsHash: async (known) =>
    coreReply<string | null>(
      await invoke<unknown>("core_call", {
        op: "tests.hash",
        args: { known },
      }),
    ),
  removeFindings: (names) => invoke<void>("remove_findings", { names }),
  readInputs: () => invoke<SensorInputs>("read_sensor_inputs"),
  shipped: () => invoke<ShippedSensors>("shipped_sensors"),
  describer: () => invoke<DescriberInEffect>("shipped_describer"),
  plannedWork: async ({ sensor, modules, suites }: WorkRequest) =>
    coreReply<PlannedWork | null>(
      await invoke<unknown>("core_call", {
        op: "sensor.work",
        args: { sensor, modules, suites },
      }),
    ),
  watchInputs: () => invoke<void>("watch_sensor_inputs"),
  onInputsChanged(run) {
    const pending = listen("sensor-inputs-changed", () => run());

    return () => void pending.then((stop) => stop());
  },
};
