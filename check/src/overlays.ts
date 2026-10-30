import type { ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { MetricDeclaration } from "./config.js";
import schema from "./generated/overlay.schema.json" with { type: "json" };

export interface Overlay {
  overlay_version: 1;
  commit: string;
  modified: boolean;
  producer: { name: string; version: string };
  metrics: MetricDeclaration[];
  values: Record<string, Record<string, number | boolean>>;
}

export interface Expected {
  commit: string;
  modified: boolean;
  metrics: MetricDeclaration[];
}

let compiled: ValidateFunction | undefined;

function validator(): ValidateFunction {
  compiled ??= new Ajv2020({ allErrors: true }).compile(schema);

  return compiled;
}

function valueProblem(
  type: MetricDeclaration["type"],
  value: number | boolean,
): string | null {
  if (type === "boolean") {
    return typeof value === "boolean" ? null : "is not a boolean";
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "is not a finite number";
  }

  if (type === "ratio" && (value < 0 || value > 1)) {
    return "is outside 0 to 1";
  }

  if (type === "count" && (!Number.isInteger(value) || value < 0)) {
    return "is not a non-negative integer";
  }

  return null;
}

function sameDeclaration(a: MetricDeclaration, b: MetricDeclaration): boolean {
  return (
    a.name === b.name &&
    a.type === b.type &&
    a.granularity === b.granularity &&
    a.bad === b.bad
  );
}

export function validateOverlay(value: unknown, expected: Expected): Overlay {
  const validate = validator();

  if (!validate(value)) {
    const first = validate.errors?.[0];

    throw new Error(
      first === undefined
        ? "overlay is invalid"
        : `overlay${first.instancePath} ${first.message ?? "is invalid"}`,
    );
  }

  const overlay = value as unknown as Overlay;

  if (overlay.commit !== expected.commit) {
    throw new Error(
      `overlay commit ${overlay.commit} is not the repository's ${expected.commit}`,
    );
  }

  if (overlay.modified !== expected.modified) {
    throw new Error(
      `overlay modified ${overlay.modified} is not the repository's ${expected.modified}`,
    );
  }

  const declared = overlay.metrics;
  const matches =
    declared.length === expected.metrics.length &&
    expected.metrics.every((metric) =>
      declared.some((candidate) => sameDeclaration(candidate, metric)),
    );

  if (!matches) {
    throw new Error("overlay metrics differ from the registered declarations");
  }

  for (const [name, byId] of Object.entries(overlay.values)) {
    const metric = declared.find((candidate) => candidate.name === name);

    if (metric === undefined) {
      throw new Error(`overlay values has undeclared metric ${name}`);
    }

    for (const [id, entry] of Object.entries(byId)) {
      const problem = valueProblem(metric.type, entry);

      if (problem !== null) {
        throw new Error(`overlay values ${name} ${id} ${problem}`);
      }
    }
  }

  return overlay;
}
