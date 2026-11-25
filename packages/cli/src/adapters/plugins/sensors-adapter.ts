import { relative } from "node:path";
import {
  type Analysis,
  type ConfigDocument,
  checkSensors,
  type FindingsRepository,
  type PluginLimits,
  type PolicyRule,
  type Repository,
  type Say,
  type SenseCall,
  type SensorReport,
  type Sensors,
  type StructureSettings,
} from "@recognizer/core";
import type { Io } from "../../cli.js";
import { policyFile } from "../../config.js";
import type { Config } from "../../config-parse.js";
import { manifestPorts } from "../../manifest-ports.js";
import type { createPluginLimits } from "../../plugin-run.js";
import { warnPolicyProblems } from "../../policy-problems.js";
import { runSensors } from "../../run-sensors.js";
import { resolveStructureSettings } from "../../structure-sensor.js";
import { diagnosisOf } from "../filesystem/diagnosis-translator.js";
import { sinkIo } from "./sink-io.js";

type Limits = ReturnType<typeof createPluginLimits>;

export class SensorsAdapter implements Sensors, Analysis {
  readonly name = "structure";

  constructor(
    private readonly io: Io,
    private readonly findings: FindingsRepository,
  ) {}

  probe(
    program: string,
    args: string[],
  ): { started: boolean; status: number | null } {
    const { started, status } = this.io.run(program, args);

    return { started, status };
  }

  readinessReports(
    root: string,
    sensors: { name: string; command: string[]; manifest?: string[] }[],
    limits: PluginLimits,
  ): SensorReport[] {
    return checkSensors(
      manifestPorts(this.io),
      root,
      sensors,
      {},
      (limits as unknown as Limits).readCommandOf,
    );
  }

  analysisPlan(config: ConfigDocument | null): StructureSettings | "off" {
    return resolveStructureSettings(config as unknown as Config | null);
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
        ...(one.manifest === undefined ? {} : { manifest: one.manifest }),
        ...(one.modules === undefined ? {} : { modules: one.modules }),
      })),
      commit: call.commit,
      scope: call.scope,
      modified: call.modified,
      findings: this.findings,
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
