import { relative } from "node:path";
import type {
  Analysis,
  CommitGapsInput,
  ConfigDocument,
  Gap,
  PluginLimits,
  PolicyRule,
  ProgramGapsInput,
  Repository,
  Say,
  SenseCall,
  Sensors,
  StructureSettings,
} from "@recognizer/core";
import type { Io } from "../../cli.js";
import { policyFile } from "../../config.js";
import type { Config } from "../../config-parse.js";
import type { createPluginLimits } from "../../plugin-run.js";
import { warnPolicyProblems } from "../../policy-problems.js";
import {
  commitGaps,
  readinessGaps,
  sensorProgramGaps,
} from "../../preflight.js";
import { runSensors } from "../../run-sensors.js";
import { resolveStructureSettings } from "../../structure-sensor.js";
import { diagnosisOf } from "../filesystem/diagnosis-translator.js";
import { shippedSensorNames } from "./shipped-plugins-adapter.js";
import { sinkIo } from "./sink-io.js";

type Limits = ReturnType<typeof createPluginLimits>;

export class SensorsAdapter implements Sensors, Analysis {
  readonly name = "structure";

  constructor(private readonly io: Io) {}

  commitGaps(input: CommitGapsInput): Gap[] {
    return commitGaps(input);
  }

  programGaps(input: ProgramGapsInput): Gap[] {
    return sensorProgramGaps({ io: this.io, ...input });
  }

  readinessGaps(
    root: string,
    sensors: { name: string; command: string[] }[],
    limits: PluginLimits,
  ): Gap[] {
    return readinessGaps(
      this.io,
      root,
      sensors,
      (limits as unknown as Limits).readOf,
    );
  }

  analysisPlan(config: ConfigDocument | null): StructureSettings | "off" {
    return resolveStructureSettings(config as unknown as Config | null);
  }

  shippedSensorNames(): string[] {
    return shippedSensorNames();
  }

  reportPolicyProblems(
    root: string,
    repository: Repository,
    rules: readonly PolicyRule[] | null,
    say: Say,
    file?: string,
  ): void {
    warnPolicyProblems(
      (text) => say("stderr", text),
      file ?? relative(root, policyFile(root)),
      repository,
      rules,
    );
  }

  async run(call: SenseCall): Promise<void> {
    await runSensors({
      io: sinkIo(this.io, call.say),
      root: call.root,
      selected: call.selected.map((one) => ({
        name: one.name,
        command: one.command,
        runsTests: one.runsTests,
        ...(one.modules === undefined ? {} : { modules: one.modules }),
      })),
      commit: call.commit,
      repository: call.repository,
      limits: call.limits as unknown as Limits,
      onStart: call.onStart,
      onEvent: (name, event) =>
        call.onEvent(name, event as unknown as Record<string, unknown>),
      onEntry: (entry) =>
        call.onEntry({
          ...entry,
          ...(entry.diagnosis === undefined
            ? {}
            : { diagnosis: diagnosisOf(entry.diagnosis) }),
        }),
    });
  }
}
