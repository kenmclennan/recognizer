export const SHIPPED_MEASURERS = {
  mutate: [
    { name: "killed", type: "count", granularity: "member", bad: "low" },
    { name: "survived", type: "count", granularity: "member", bad: "high" },
    { name: "uncovered", type: "count", granularity: "member", bad: "high" },
    { name: "score", type: "ratio", granularity: "member", bad: "low" },
  ],
} as const;

export interface ShippedSensorEntry {
  name: string;
  line: string;
  defaults: Record<string, number | boolean | string>;
}

export const SHIPPED_SENSOR_LIST: readonly ShippedSensorEntry[] = [
  {
    name: "duplication",
    line: "Finds functions whose structure repeats another's, so shared logic can be extracted once.",
    defaults: { threshold: 0.82, min_lines: 4, min_nodes: 20 },
  },
  {
    name: "crap",
    line: "Flags functions that are complex and poorly covered by tests, where a change is most likely to break something.",
    defaults: {
      threshold: 30,
      coverage: "coverage/lcov.info",
      overlay: ".recognizer/cache/overlays/crap.json",
    },
  },
  {
    name: "mutation",
    line: "Warns on functions where a mutated copy still passes the tests, naming each surviving mutation.",
    defaults: {
      overlay: ".recognizer/cache/overlays/mutate.json",
      survivors: ".recognizer/cache/mutation/survivors.json",
    },
  },
  {
    name: "unused-exports",
    line: "Lists the exports of each module that no other module uses, so dead public surface can be trimmed.",
    defaults: {},
  },
  {
    name: "thresholds",
    line: "Turns any overlay metric over a configured line into a finding, with complexity and coverage lines built in.",
    defaults: {},
  },
];

export const SHIPPED_SENSORS: readonly string[] = SHIPPED_SENSOR_LIST.map(
  ({ name }) => name,
);

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

export function expandMeasurerShortForms(
  entries: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (entries === undefined) {
    return entries;
  }

  return Object.fromEntries(
    Object.entries(entries).map(([name, entry]) =>
      name === "mutate" && isSettingsMapping(entry)
        ? [
            name,
            {
              command: shippedCommand(name, entry),
              metrics: SHIPPED_MEASURERS.mutate.map((metric) => ({
                ...metric,
              })),
            },
          ]
        : [name, entry],
    ),
  );
}
