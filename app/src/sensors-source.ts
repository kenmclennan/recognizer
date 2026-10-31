import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  FindingsFiles,
  SensorInputs,
  SensorsPort,
  SensorsRunResult,
} from "./sensor-run";

type SenseReport =
  | {
      status: "sensed";
      commit: string;
      modified: boolean;
      sensors: { name: string; status: "ran" | "failed"; reason?: string }[];
    }
  | { status: "command-missing"; hint: string }
  | { status: "failed"; exitCode: number; stderr: string };

function runResult(report: SenseReport): SensorsRunResult {
  switch (report.status) {
    case "sensed":
      return { status: "sensed", sensors: report.sensors };
    case "command-missing":
      return report;
    case "failed":
      return {
        status: "failed",
        reason:
          report.stderr.trim() === ""
            ? `recognizer sense exited ${report.exitCode}`
            : report.stderr.trim(),
      };
  }
}

export const sensorsSource: SensorsPort = {
  writeStructure: (document) => invoke<void>("write_structure", { document }),
  readFindings: () => invoke<FindingsFiles>("read_findings"),
  removeFindings: (names) => invoke<void>("remove_findings", { names }),
  readInputs: () => invoke<SensorInputs>("read_sensor_inputs"),
  run: async (names) =>
    runResult(await invoke<SenseReport>("run_sensors", { names })),
  onInputsChanged(run) {
    void invoke<void>("watch_sensor_inputs");

    const pending = listen("sensor-inputs-changed", () => run());

    return () => void pending.then((stop) => stop());
  },
};
