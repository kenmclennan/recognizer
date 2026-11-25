import type { PhaseRecorder } from "../../domain/phase-recorder.js";
import type { Repository } from "../../domain/repository.js";
import type { RunScope } from "../../domain/run-scope.js";
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
  runScope: RunScope;
  modified: boolean | null;
  repository: Repository;
  limits: PluginLimits;
  sink: ScanSink;
  recorder: PhaseRecorder;
}

export async function runSensors(
  ports: SensingPorts,
  input: RunSensorsInput,
): Promise<void> {
  const { sensors, clock } = ports;
  const {
    root,
    selected,
    scope,
    commit,
    runScope,
    modified,
    repository,
    limits,
    sink,
    recorder,
  } = input;
  const phase = recorder.start("sense");

  sink.emit({
    type: "phase",
    phase: "sense",
    detail: { total: selected.length },
  });

  const senseFrom = clock.awake();

  const runnable = selected.filter((one) => one.broken === undefined);

  for (const one of selected) {
    if (one.broken !== undefined) {
      sink.say("stderr", `${one.name}: ${one.broken.reason}\n`);

      recorder.entry(phase, {
        name: one.name,
        command: one.manifest ?? one.command,
        status: null,
        outcome: "failed",
        duration_ms: 0,
        reason: one.broken.reason,
        stderr: "",
      });
    }
  }

  await sensors.run({
    root,
    selected: runnable.map((one) => ({
      ...one,
      ...(scope !== undefined && one.scoped
        ? { modules: scope.names.length }
        : {}),
    })),
    commit: commit ?? "",
    scope: runScope,
    modified,
    repository,
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
