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
  metrics: readonly ShippedMetric[];
}

export const SHIPPED_SENSOR_LIST: readonly ShippedSensorEntry[] = [
  {
    name: "duplication",
    display: "Duplication",
    line: "Finds functions whose structure repeats another's, so shared logic can be extracted once.",
    defaults: {
      threshold: 0.82,
      min_lines: 4,
      min_nodes: 20,
    },
    runs_tests: false,
    listed: true,
    metrics: [],
  },
  {
    name: "crap",
    display: "C.R.A.P.",
    line: "Runs the tests under coverage and flags functions that are complex and poorly covered, where a change is most likely to break something.",
    defaults: {
      threshold: 30,
    },
    runs_tests: true,
    listed: true,
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
    metrics: [],
  },
];

export const SHIPPED_SENSORS: readonly string[] = SHIPPED_SENSOR_LIST.map(
  ({ name }) => name,
);

export function shippedSensorNames(): string[] {
  return [...SHIPPED_SENSORS];
}

export function runsTests(command: readonly string[]): boolean {
  if (command[0] !== "recognizer-sensors") {
    return false;
  }

  return SHIPPED_SENSOR_LIST.some(
    (entry) => entry.runs_tests && entry.name === command[1],
  );
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
    "recognizer-sensors",
    name,
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

export function expandShortForms(
  entries: Record<string, unknown> | undefined,
  shipped: readonly string[],
): Record<string, unknown> | undefined {
  if (entries === undefined) {
    return entries;
  }

  return Object.fromEntries(
    Object.entries(entries).map(([name, entry]) =>
      shipped.includes(name) && isSettingsMapping(entry)
        ? [name, { command: shippedCommand(name, entry) }]
        : [name, entry],
    ),
  );
}
