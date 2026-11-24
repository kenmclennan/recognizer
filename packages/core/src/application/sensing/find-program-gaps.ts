import { type Gap, installFix } from "../../domain/gap.js";
import { sensorNameOf, sensorProgram } from "../plugins/installed-sensors.js";
import type { SensingPorts } from "./internal/sensing-ports.js";

export interface ProgramGapsInput {
  sensors: { name: string; command: string[] }[];
  install: Record<string, string>;
}

export function findProgramGaps(
  ports: SensingPorts,
  input: ProgramGapsInput,
): Gap[] {
  return input.sensors.flatMap((sensor) => {
    const name = sensorNameOf(sensor.command);

    if (name === undefined) {
      return [];
    }

    const program = sensorProgram(name);
    const result = ports.sensors.probe(program, ["--version"]);

    return result.started && result.status === 0
      ? []
      : [
          {
            id: `sensors:missing:${name}`,
            line: `${program} is not installed`,
            needs: [sensor.name],
            fix: installFix(input.install, program),
          },
        ];
  });
}
