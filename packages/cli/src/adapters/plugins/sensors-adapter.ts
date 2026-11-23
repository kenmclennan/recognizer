import { relative, resolve } from "node:path";
import {
  type Analysis,
  type CommitGapsInput,
  type ConfigDocument,
  type Gap,
  isScoped,
  type PlannedSensor,
  type PluginLimits,
  type PolicyRule,
  type ProgramGapsInput,
  type Repository,
  readShippedSensors,
  refuseUnregistered,
  runsTests,
  type Say,
  type SenseCall,
  type SensorPlan,
  type SensorPlanInput,
  type SensorRow,
  type SensorSelection,
  type SensorSelectionInput,
  type Sensors,
  type ShippedRead,
  type StructureSettings,
  shippedSensorOf,
} from "@recognizer/core";
import type { Io } from "../../cli.js";
import { policyFile, readConfig } from "../../config.js";
import { type Config, registeredSensors } from "../../config-parse.js";
import { asInputError, InputError } from "../../errors.js";
import { shippedPorts } from "../../manifest-ports.js";
import type { createPluginLimits } from "../../plugin-run.js";
import { warnPolicyProblems } from "../../policy-problems.js";
import {
  commitGaps,
  readinessGaps,
  sensorProgramGaps,
} from "../../preflight.js";
import { runSensors } from "../../run-sensors.js";
import { parseSuiteSelection, selectSensors } from "../../scan-phases.js";
import { resolveStructureSettings } from "../../structure-sensor.js";
import { diagnosisOf } from "../filesystem/diagnosis-translator.js";
import { shippedSensorNames } from "./shipped-plugins-adapter.js";
import { sinkIo } from "./sink-io.js";

type Limits = ReturnType<typeof createPluginLimits>;

interface Selection {
  selected: { name: string; command: string[] }[];
  shipped: ShippedRead;
}

function namesOf(sense: null | "all" | { name: string }[]): "all" | string[] {
  return sense === "all" || sense === null
    ? "all"
    : sense.map((one) => one.name);
}

function readSuitesFile(io: Io, file: string): string {
  try {
    return io.readFile(resolve(file));
  } catch (error) {
    throw new InputError([
      `cannot read --suites file ${file}: ${(error as Error).message}`,
    ]);
  }
}

export class SensorsAdapter implements Sensors, Analysis {
  readonly name = "structure";

  constructor(private readonly io: Io) {}

  select(input: SensorSelectionInput): SensorSelection {
    const config = input.config as unknown as Config | null;
    const { sense } = input;
    const shippedNames = shippedSensorNames();
    let shipped: ShippedRead = { sensors: [], unreadable: [] };
    let selected: { name: string; command: string[] }[] = [];

    if (sense !== null) {
      const requested = namesOf(sense);
      const wanted = new Set<string>(
        Array.isArray(requested)
          ? requested.filter((name) => shippedNames.includes(name))
          : [],
      );

      for (const one of registeredSensors(config)) {
        const name = shippedSensorOf(one.command, shippedNames);

        if (name !== undefined) {
          wanted.add(name);
        }
      }

      shipped = readShippedSensors(
        shippedPorts(this.io),
        (input.limits as unknown as Limits).readOf,
        [...wanted],
      );
    }

    const registered = registeredSensors(config).map((one) => one.name);

    if (sense !== null) {
      selected = selectSensors(
        registeredSensors(config),
        namesOf(sense),
        shippedSensorNames(),
        config?.tests,
        shipped,
      );
    }

    asInputError(() =>
      refuseUnregistered(
        registered,
        Array.isArray(namesOf(sense)) && sense !== null
          ? (namesOf(sense) as string[])
          : [],
        shippedNames,
      ),
    );

    const selection: Selection = { selected, shipped };

    return selection as unknown as SensorSelection;
  }

  plan(input: SensorPlanInput): SensorPlan {
    const { selected, shipped } = input.selection as unknown as Selection;
    const config = input.config as unknown as Config | null;
    const configured = (config?.tests ?? []).map((suite) => suite.name);
    const parsed =
      input.suitesFile === undefined
        ? {}
        : parseSuiteSelection(
            readSuitesFile(this.io, input.suitesFile),
            configured,
            selected.map((one) => ({
              name: one.name,
              runsTests: runsTests(one.command, shipped),
            })),
          );
    const explicit: Record<string, string[]> = { ...parsed };

    if (Array.isArray(input.sense)) {
      for (const one of input.sense) {
        if (one.suites !== undefined && explicit[one.name] === undefined) {
          explicit[one.name] = one.suites;
        }
      }
    }

    const chosen: Record<string, string[]> = {};

    for (const one of selected.filter((entry) =>
      runsTests(entry.command, shipped),
    )) {
      const names = explicit[one.name] ?? configured;

      chosen[one.name] = configured.filter((name) => names.includes(name));
    }

    const scoped = (command: string[]): string[] =>
      input.modulesFile !== undefined && isScoped(command, shipped)
        ? [...command, "--modules", resolve(input.modulesFile)]
        : command;
    const withSuites = (name: string, command: string[]): string[] => {
      const names = explicit[name];

      return names !== undefined && runsTests(command, shipped)
        ? [...command, "--suites", JSON.stringify(chosen[name] ?? names)]
        : command;
    };

    const planned: PlannedSensor[] = selected.map(({ name, command }) => ({
      name,
      command: withSuites(name, scoped(command)),
      runsTests: runsTests(command, shipped),
      scoped: isScoped(command, shipped),
    }));

    return { selected: planned, chosen };
  }

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

  registered(root: string): SensorRow[] {
    const config = readConfig(this.io, root, ["sensors", "tests"]);
    const suites = (config?.tests ?? []).map(({ name, language }) => ({
      name,
      language,
    }));
    const names = new Set(registeredSensors(config).map(({ name }) => name));
    const shipped = readShippedSensors(shippedPorts(this.io));
    const rows: SensorRow[] = shipped.sensors
      .filter(({ listed }) => listed)
      .sort((a, b) => a.display.localeCompare(b.display))
      .map((one) => ({
        name: one.name,
        display: one.display,
        runsTests: one.runs_tests,
        scoped: one.scoped,
        registered: names.has(one.name),
        ...(one.runs_tests && suites.length > 0 ? { suites } : {}),
      }));
    const known = new Set(shippedSensorNames());

    for (const name of names) {
      if (!known.has(name)) {
        rows.push({
          name,
          display: name,
          runsTests: false,
          scoped: false,
          registered: true,
        });
      }
    }

    return rows;
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
