import { InvalidRequest } from "../../domain/invalid-request.js";
import { parseSuiteSelection } from "../../domain/sensing/suite-selection.js";
import { isScoped, runsTests } from "../plugins/installed-sensors.js";
import type { SensingPorts } from "./internal/sensing-ports.js";
import type {
  PlannedSensor,
  SensorPlan,
  SensorPlanInput,
} from "./ports/sensors.js";

export type { PlannedSensor, SensorPlan, SensorPlanInput };

function suitesText(ports: SensingPorts, file: string): string {
  const read = ports.files.read(file);

  if (!read.ok) {
    throw new InvalidRequest([
      `cannot read --suites file ${file}: ${read.reason}`,
    ]);
  }

  return read.text;
}

export function planSensors(
  ports: SensingPorts,
  input: SensorPlanInput,
): SensorPlan {
  const { selected, installed } = input.selection;
  const configured = (ports.config.tests(input.config) ?? []).map(
    (suite) => suite.name,
  );
  const parsed =
    input.suitesFile === undefined
      ? {}
      : parseSuiteSelection(
          suitesText(ports, input.suitesFile),
          configured,
          selected.map((one) => ({
            name: one.name,
            runsTests: runsTests(one.command, installed),
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
    runsTests(entry.command, installed),
  )) {
    const names = explicit[one.name] ?? configured;

    chosen[one.name] = configured.filter((name) => names.includes(name));
  }

  const { modulesFile } = input;
  const scoped = (command: string[]): string[] =>
    modulesFile !== undefined && isScoped(command, installed)
      ? [...command, "--modules", ports.files.absolute(modulesFile)]
      : command;
  const withSuites = (name: string, command: string[]): string[] => {
    const names = explicit[name];

    return names !== undefined && runsTests(command, installed)
      ? [...command, "--suites", JSON.stringify(chosen[name] ?? names)]
      : command;
  };

  const planned: PlannedSensor[] = selected.map(({ name, command }) => ({
    name,
    command: withSuites(name, scoped(command)),
    runsTests: runsTests(command, installed),
    scoped: isScoped(command, installed),
  }));

  return { selected: planned, chosen };
}
