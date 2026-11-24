export interface UndeclaredSensor {
  name: string;
  line: string;
  fix: string;
  suitesWithheld: boolean;
}

const SENSE_PREFIX = "recognizer-sense-";

export function notMeasuredLine(name: string): string {
  return `not measured ${name}: the configured suites were not handed to it`;
}

export function manifestFix(name: string, command: readonly string[]): string {
  const program = command[0] ?? "";
  const first = program.startsWith(SENSE_PREFIX) ? program : "<first word>";
  const next = program.startsWith(SENSE_PREFIX) ? "manifest" : "<next word>";
  const add = (word: string) =>
    `recognizer config --add sensors.${name}.manifest ${word}`;

  return `${add(first)} && ${add(next)}`;
}

export function undeclaredSensors(
  registered: readonly {
    name: string;
    command: string[];
    manifest?: string[];
  }[],
  suitesConfigured: boolean,
): UndeclaredSensor[] {
  return registered
    .filter((sensor) => sensor.manifest === undefined)
    .map((sensor) => {
      const fix = manifestFix(sensor.name, sensor.command);

      return {
        name: sensor.name,
        line: `${sensor.name} declares nothing until its manifest is added (no suites, no scope, no check): ${fix}`,
        fix,
        suitesWithheld: suitesConfigured,
      };
    });
}
