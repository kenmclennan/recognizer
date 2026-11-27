import { type Gap, installFix } from "../../domain/gap.js";
import { sensorNameOf } from "../plugins/installed-sensors.js";
import type { SensingPorts } from "./internal/sensing-ports.js";

export interface ProgramGapsInput {
  sensors: { name: string; command: string[]; manifest?: string[] }[];
  install: Record<string, string>;
}

export function findProgramGaps(
  ports: SensingPorts,
  input: ProgramGapsInput,
): Gap[] {
  return input.sensors.flatMap((sensor) => {
    const program = sensor.manifest?.[0];

    if (program === undefined) {
      return [];
    }

    const runs = sensor.command[0] ?? program;
    const result = ports.sensors.probe(runs, ["--version"]);
    const strict = sensorNameOf([program]) !== undefined;
    const fine = strict
      ? result.started && result.status === 0
      : result.started;

    return fine
      ? []
      : [
          {
            id: `sensors:missing:${sensorNameOf([program]) ?? program}`,
            line: `${program} is not installed`,
            needs: [sensor.name],
            fix: installFix(input.install, program),
          },
        ];
  });
}
