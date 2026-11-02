export const SHIPPED_MEASURERS = {
  mutate: [
    { name: "killed", type: "count", granularity: "member", bad: "low" },
    { name: "survived", type: "count", granularity: "member", bad: "high" },
    { name: "uncovered", type: "count", granularity: "member", bad: "high" },
    { name: "score", type: "ratio", granularity: "member", bad: "low" },
  ],
} as const;

export const SHIPPED_SENSORS: readonly string[] = [
  "duplication",
  "crap",
  "mutation",
  "unused-exports",
];

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
