import { resolve } from "node:path";
import { type ConfigEdit, InvalidRequest } from "@recognizer/core";
import type { Io } from "../cli.js";
import { configurationFor } from "../configuration-composition.js";
import { ArgsError, text } from "./wire.js";

const OPS = ["set", "unset", "add-section"];

function editsOf(args: Record<string, unknown>): ConfigEdit[] {
  const given = args.edits;

  if (!Array.isArray(given)) {
    throw new ArgsError(["edits must be a list"]);
  }

  return given.map((entry): ConfigEdit => {
    const edit = entry as { op?: unknown; key?: unknown; value?: unknown };

    if (
      typeof edit?.op !== "string" ||
      !OPS.includes(edit.op) ||
      typeof edit.key !== "string"
    ) {
      throw new ArgsError(["every edit needs an op and a key"]);
    }

    return {
      op: edit.op as ConfigEdit["op"],
      key: edit.key,
      ...(typeof edit.value === "string" ? { value: edit.value } : {}),
    };
  });
}

export function configKeys(io: Io): unknown {
  const read = configurationFor(io).readKeySchema();

  return read.status === "ok"
    ? { status: "ok", schema: read.schema }
    : {
        status: "unavailable",
        reason: read.lines
          .map((line) => `recognizer config: ${line}`)
          .join("\n"),
      };
}

export function configWrite(io: Io, args: Record<string, unknown>): unknown {
  const root = resolve(text(args, "repository"));
  const edits = editsOf(args);

  if (typeof args.baseHash !== "string") {
    throw new ArgsError(["baseHash must be a string"]);
  }

  try {
    return configurationFor(io).writeConfigEdits({
      root,
      edits,
      baseHash: args.baseHash,
    });
  } catch (error) {
    if (error instanceof InvalidRequest) {
      return {
        status: "refused",
        key: null,
        reason: error.messages[0] ?? error.message,
      };
    }

    throw error;
  }
}
