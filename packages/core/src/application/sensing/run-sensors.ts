import type { PhaseRecorder } from "../../domain/phase-recorder.js";
import type { ScanDocument } from "../../domain/scan-document.js";
import type { ScanSink } from "../../domain/scan-sink.js";
import type { ScopeFile } from "../../domain/sensor-request.js";
import type { PluginLimits } from "../shared/ports/process.js";
import type { SensingPorts } from "./internal/sensing-ports.js";
import type { PlannedSensor } from "./ports/sensors.js";

export interface RunSensorsInput {
  root: string;
  selected: PlannedSensor[];
  scope: ScopeFile | undefined;
  commit: string | null;
  scans: ScanDocument[];
  limits: PluginLimits;
  sink: ScanSink;
  recorder: PhaseRecorder;
}

export async function runSensors(
  ports: SensingPorts,
  input: RunSensorsInput,
): Promise<void> {
  const { sensors, clock } = ports;
  const { root, selected, scope, commit, scans, limits, sink, recorder } =
    input;
  const phase = recorder.start("sense");

  sink.emit({
    type: "phase",
    phase: "sense",
    detail: { total: selected.length },
  });

  const senseFrom = clock.awake();

  await sensors.run({
    root,
    selected: selected.map((one) => ({
      ...one,
      ...(scope !== undefined && one.scoped
        ? { modules: scope.names.length }
        : {}),
    })),
    commit: commit ?? "",
    scans,
    limits,
    onStart: (name) => {
      sink.emit({ type: "start", phase: "sense", name });
    },
    onEvent: (name, data) => {
      sink.emit({ type: "plugin", phase: "sense", name, data });
    },
    onEntry: (entry) => {
      recorder.entry(phase, entry);
    },
    say: sink.say,
  });

  if (sink.stopped) {
    return;
  }

  phase.duration_ms = clock.awake() - senseFrom;
}
