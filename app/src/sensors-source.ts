import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  FindingsFiles,
  OverlayFiles,
  SensorInputs,
  SensorsPort,
  ShippedSensors,
} from "./sensor-run";

export const sensorsSource: SensorsPort = {
  writeStructure: (document) => invoke<void>("write_structure", { document }),
  readFindings: () => invoke<FindingsFiles>("read_findings"),
  readOverlays: () => invoke<OverlayFiles>("read_overlays"),
  removeFindings: (names) => invoke<void>("remove_findings", { names }),
  readInputs: () => invoke<SensorInputs>("read_sensor_inputs"),
  shipped: () => invoke<ShippedSensors>("shipped_sensors"),
  edit: (name, add) => invoke<void>("edit_sensor", { name, add }),
  onInputsChanged(run) {
    void invoke<void>("watch_sensor_inputs");

    const pending = listen("sensor-inputs-changed", () => run());

    return () => void pending.then((stop) => stop());
  },
};
