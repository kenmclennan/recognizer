import {
  type EstimateAnswer,
  type EstimateRequest,
  estimateFrom,
  type PartSpec,
  type PlannedWork,
  scanHistory,
} from "@recognizer/core";
import type { Io } from "../cli.js";
import { readRunRecordFiles } from "./refusals.js";
import { ArgsError } from "./wire.js";

export function readEstimate(
  io: Io,
  root: string,
  request: EstimateRequest,
): EstimateAnswer {
  return estimateFrom(scanHistory(readRunRecordFiles(io, root)), request);
}

function recordOf(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ArgsError([`${name} must be an object`]);
  }

  return value as Record<string, unknown>;
}

function numbersOf(value: unknown, name: string): Record<string, number> {
  const given = recordOf(value, name);

  for (const one of Object.values(given)) {
    if (typeof one !== "number") {
      throw new ArgsError([`${name} must map a name to a number`]);
    }
  }

  return given as Record<string, number>;
}

export function estimateRequestOf(
  args: Record<string, unknown>,
): EstimateRequest {
  const intent = recordOf(args.intent, "intent");
  const sense = intent.sense;
  const parts = args.parts;

  if (
    typeof intent.describe !== "boolean" ||
    typeof intent.analysis !== "boolean" ||
    !Array.isArray(sense) ||
    sense.some((one) => typeof one !== "string") ||
    !Array.isArray(parts)
  ) {
    throw new ArgsError(["intent and parts are not the shape of a plan"]);
  }

  const specs = parts.map((one): PartSpec => {
    const part = recordOf(one, "parts");

    if (
      typeof part.key !== "string" ||
      typeof part.name !== "string" ||
      typeof part.runsTests !== "boolean" ||
      typeof part.scoped !== "boolean" ||
      (part.workVerb !== null && typeof part.workVerb !== "string")
    ) {
      throw new ArgsError(["a part needs a key, a name and its flags"]);
    }

    return {
      key: part.key,
      name: part.name,
      runsTests: part.runsTests,
      scoped: part.scoped,
      workVerb: part.workVerb,
    };
  });
  const given = recordOf(args.work, "work");
  const work: Record<string, PlannedWork> = {};

  for (const [key, one] of Object.entries(given)) {
    const planned = recordOf(one, "work");

    if (
      typeof planned.unit !== "string" ||
      typeof planned.to_perform !== "number"
    ) {
      throw new ArgsError(["work must name a unit and a count"]);
    }

    work[key] = { unit: planned.unit, to_perform: planned.to_perform };
  }

  return {
    intent: {
      describe: intent.describe,
      analysis: intent.analysis,
      sense: sense as string[],
    },
    planWork: numbersOf(args.planWork, "planWork"),
    parts: specs,
    work,
  };
}
