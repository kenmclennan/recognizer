import type { KeySchema } from "../../domain/configuration/published-keys.js";
import type { KeyOwners } from "./ports/key-owners.js";

export type KeySchemaOutcome =
  | { status: "ok"; schema: KeySchema }
  | { status: "not-answering"; lines: string[] };

export function readKeySchema(ports: {
  keyOwners: KeyOwners;
}): KeySchemaOutcome {
  const read = ports.keyOwners.schemas();

  return read.notAnswering.length > 0
    ? { status: "not-answering", lines: read.notAnswering }
    : { status: "ok", schema: read.schema };
}
