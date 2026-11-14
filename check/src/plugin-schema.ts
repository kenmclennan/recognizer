import type { Io } from "./cli.js";
import { InputError } from "./errors.js";
import checkSchema from "./generated/check.schema.json" with { type: "json" };
import eventsSchema from "./generated/events.schema.json" with { type: "json" };
import findingsSchema from "./generated/findings.schema.json" with {
  type: "json",
};
import manifestSchema from "./generated/manifest.schema.json" with {
  type: "json",
};
import overlaySchema from "./generated/overlay.schema.json" with {
  type: "json",
};
import scanSchema from "./generated/scan.schema.json" with { type: "json" };

export const SCHEMAS: Record<string, unknown> = {
  manifest: manifestSchema,
  events: eventsSchema,
  scan: scanSchema,
  findings: findingsSchema,
  overlay: overlaySchema,
  check: checkSchema,
};

export const SCHEMA_NAMES = Object.keys(SCHEMAS);

export function runSchema(argv: string[], io: Io): number {
  const [name, ...rest] = argv;

  if (name === undefined || rest.length > 0 || !Object.hasOwn(SCHEMAS, name)) {
    throw new InputError([
      "usage: recognizer plugin schema <name>",
      `names: ${SCHEMA_NAMES.join(", ")}`,
    ]);
  }

  io.stdout(`${JSON.stringify(SCHEMAS[name], null, 2)}\n`);

  return 0;
}
