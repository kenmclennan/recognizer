import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { FindingsFiles, SensorInputs, SensorsPort } from "./sensor-run";

export const sensorsSource: SensorsPort = {
  writeStructure: (document) => invoke<void>("write_structure", { document }),
  readFindings: () => invoke<FindingsFiles>("read_findings"),
  removeFindings: (names) => invoke<void>("remove_findings", { names }),
  readInputs: () => invoke<SensorInputs>("read_sensor_inputs"),
  onInputsChanged(run) {
    void invoke<void>("watch_sensor_inputs");

    const pending = listen("sensor-inputs-changed", () => run());

    return () => void pending.then((stop) => stop());
  },
};
