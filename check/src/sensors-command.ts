import { parseArgs } from "node:util";
import type { Io } from "./cli.js";
import { InputError } from "./errors.js";
import { SHIPPED_SENSOR_LIST } from "./shipped-sensors.js";

export function runSensors(argv: string[], io: Io): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: { json: { type: "boolean" } },
  });

  if (positionals.length > 0) {
    throw new InputError(["usage: recognizer sensors [--json]"]);
  }

  if (values.json === true) {
    io.stdout(`${JSON.stringify(SHIPPED_SENSOR_LIST, null, 2)}\n`);

    return 0;
  }

  io.stdout(
    `${SHIPPED_SENSOR_LIST.map(({ name, line }) => `${name}  ${line}`).join("\n")}\n`,
  );

  return 0;
}
