export interface ShippedMetric {
  name: string;
  type: "ratio" | "count" | "number" | "boolean";
  granularity: "module" | "member";
  bad: "high" | "low";
}

export interface ShippedSensorEntry {
  name: string;
  display: string;
  line: string;
  defaults: Record<string, number | boolean | string>;
  runs_tests: boolean;
  listed: boolean;
  scoped: boolean;
  metrics: readonly ShippedMetric[];
}

export const SHIPPED_SENSOR_LIST: readonly ShippedSensorEntry[] = [
  {
    name: "crap",
    display: "C.R.A.P.",
    line: "Runs the tests under coverage and flags functions that are complex and poorly covered, where a change is most likely to break something.",
    defaults: {
      threshold: 30,
    },
    runs_tests: true,
    listed: true,
    scoped: false,
    metrics: [
      {
        name: "complexity",
        type: "count",
        granularity: "member",
        bad: "high",
      },
      {
        name: "coverage",
        type: "ratio",
        granularity: "member",
        bad: "low",
      },
      {
        name: "crap",
        type: "number",
        granularity: "member",
        bad: "high",
      },
    ],
  },
  {
    name: "mutation",
    display: "Mutation",
    line: "Mutates covered functions, reruns the tests, and warns where a mutated copy still passes, naming each surviving mutation.",
    defaults: {},
    runs_tests: true,
    listed: true,
    scoped: true,
    metrics: [
      {
        name: "killed",
        type: "count",
        granularity: "member",
        bad: "low",
      },
      {
        name: "survived",
        type: "count",
        granularity: "member",
        bad: "high",
      },
      {
        name: "uncovered",
        type: "count",
        granularity: "member",
        bad: "high",
      },
      {
        name: "score",
        type: "ratio",
        granularity: "member",
        bad: "low",
      },
    ],
  },
  {
    name: "thresholds",
    display: "Thresholds",
    line: "Turns any overlay metric over a configured line into a finding, with complexity and coverage lines built in.",
    defaults: {},
    runs_tests: false,
    listed: false,
    scoped: false,
    metrics: [],
  },
];

export const SHIPPED_SENSORS: readonly string[] = SHIPPED_SENSOR_LIST.map(
  ({ name }) => name,
);

export function shippedSensorNames(): string[] {
  return [...SHIPPED_SENSORS];
}

const SENSE_PREFIX = "recognizer-sense-";

export function shippedSensorOf(
  command: readonly string[],
): ShippedSensorEntry | undefined {
  const program = command[0];

  if (program === undefined || !program.startsWith(SENSE_PREFIX)) {
    return undefined;
  }

  const name = program.slice(SENSE_PREFIX.length);

  return SHIPPED_SENSOR_LIST.find((entry) => entry.name === name);
}

export function runsTests(command: readonly string[]): boolean {
  return shippedSensorOf(command)?.runs_tests === true;
}

export function isScoped(command: readonly string[]): boolean {
  return shippedSensorOf(command)?.scoped === true;
}

function isSettingsMapping(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !("command" in value)
  );
}

export function shippedCommand(
  name: string,
  settings: Record<string, unknown>,
): string[] {
  return [
    `${SENSE_PREFIX}${name}`,
    "run",
    "--repository",
    "{repository}",
    "--commit",
    "{commit}",
    "--output",
    "{output}",
    "--settings",
    JSON.stringify(settings),
  ];
}

export function receivesSuites(name: string): boolean {
  return SHIPPED_SENSOR_LIST.some(
    (entry) => entry.runs_tests && entry.name === name,
  );
}

export function expandShortForms(
  entries: Record<string, unknown> | undefined,
  shipped: readonly string[],
  suites?: readonly unknown[],
): Record<string, unknown> | undefined {
  if (entries === undefined) {
    return entries;
  }

  return Object.fromEntries(
    Object.entries(entries).map(([name, entry]) =>
      shipped.includes(name) && isSettingsMapping(entry)
        ? [
            name,
            {
              command: shippedCommand(
                name,
                receivesSuites(name) && suites !== undefined
                  ? { ...entry, tests: suites }
                  : entry,
              ),
            },
          ]
        : [name, entry],
    ),
  );
}
