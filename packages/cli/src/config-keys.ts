import {
  compileKeySchema,
  type KeySchema,
  type PublishedKeys,
  publishedFor,
} from "@recognizer/core";
import { KeyOwnersAdapter } from "./adapters/plugins/key-owners-adapter.js";
import type { Io } from "./cli.js";
import validateKeySchema from "./generated/config-keys-validator.js";

function describeErrors(): string {
  const errors = validateKeySchema.errors ?? [];

  return errors
    .map((error) => `${error.instancePath || "/"} ${error.message}`)
    .join("; ");
}

export function parseKeySchema(
  text: string,
): { schema: KeySchema } | { reason: string } {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return { reason: "it printed invalid JSON" };
  }

  const version = (parsed as { keys_version?: unknown } | null)?.keys_version;

  if (version !== 1) {
    return {
      reason: `its keys_version is ${JSON.stringify(version)}, not the 1 this recognizer reads`,
    };
  }

  if (!validateKeySchema(parsed)) {
    return { reason: `its key schema is invalid: ${describeErrors()}` };
  }

  const schema = parsed as KeySchema;

  try {
    compileKeySchema(schema);
  } catch (error) {
    return { reason: (error as Error).message };
  }

  return { schema };
}

export function loadKeys(io: Io, root: string): PublishedKeys {
  return publishedFor("config", new KeyOwnersAdapter(io), root);
}
