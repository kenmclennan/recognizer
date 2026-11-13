import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { RunRecordFiles } from "./refusal-record";
import type { PlannedWork } from "./scan-estimate";
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
  writeStructure: (document) => invoke<void>("write_structure", { document }),
  readFindings: () => invoke<FindingsFiles>("read_findings"),
  readOverlays: () => invoke<OverlayFiles>("read_overlays"),
  readRunRecords: () => invoke<RunRecordFiles>("read_run_records"),
  readTestsHash: (known) => invoke<string>("read_tests_hash", { known }),
  removeFindings: (names) => invoke<void>("remove_findings", { names }),
  readInputs: () => invoke<SensorInputs>("read_sensor_inputs"),
  shipped: () => invoke<ShippedSensors>("shipped_sensors"),
  describer: () => invoke<DescriberInEffect>("shipped_describer"),
  plannedWork: ({ sensor, modules, suites }: WorkRequest) =>
    invoke<PlannedWork | null>("planned_work", { sensor, modules, suites }),
  onInputsChanged(run) {
    void invoke<void>("watch_sensor_inputs");

    const pending = listen("sensor-inputs-changed", () => run());

    return () => void pending.then((stop) => stop());
  },
};
