import { typedValue } from "./key-value.js";
import type { KeyEntry, PublishedKeyValues } from "./published-keys.js";

export interface ThresholdsMigration {
  line: string;
  command: string;
}

const COMPLEXITY_SWITCH = "sensors.structure.warnings.complexity";
const COMPLEXITY_KEY = `${COMPLEXITY_SWITCH}.limit`;
const DEFAULT_COMPLEXITY = 10;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function at(document: unknown, path: string[]): unknown {
  let node = document;

  for (const step of path) {
    if (!isPlainObject(node) || !(step in node)) {
      return undefined;
    }

    node = node[step];
  }

  return node;
}

interface Plan {
  steps: string[];
  notes: string[];
}

function publishedFor(
  name: string,
  keys: PublishedKeyValues,
): { entry: KeyEntry; field: string } | null {
  const prefix = `sensors.thresholds.${name}.`;

  for (const published of keys) {
    if (
      published.replaces?.startsWith(prefix) === true &&
      published.type !== undefined
    ) {
      return {
        entry: published as KeyEntry,
        field: published.replaces.slice(prefix.length),
      };
    }
  }

  return null;
}

function isSingleValue(value: unknown): value is string | number | boolean {
  return (
    typeof value === "string" || typeof value === "boolean" || isNumber(value)
  );
}

function publishedSteps(
  name: string,
  entry: unknown,
  document: unknown,
  keys: PublishedKeyValues,
): Plan {
  const plan: Plan = { steps: [], notes: [] };
  const found = publishedFor(name, keys);

  if (found === null) {
    plan.notes.push(`${name} has no replacement and is dropped`);

    return plan;
  }

  const published = found.entry;

  if (at(document, published.key.split(".")) !== undefined) {
    plan.notes.push(`${published.key} is already set and is left alone`);

    return plan;
  }

  if (entry === "off") {
    if (published.off === true) {
      plan.steps.push(`recognizer config ${published.key} false`);
    } else {
      plan.notes.push(
        `${name}: off has no equivalent for ${published.key} and is dropped`,
      );
    }

    return plan;
  }

  if (!isPlainObject(entry)) {
    plan.notes.push(`${name} had no usable form and is dropped`);

    return plan;
  }

  const value = entry[found.field];

  if (isSingleValue(value)) {
    const typed = typedValue(published, String(value));

    if ("reason" in typed) {
      plan.notes.push(
        `${name}.${found.field} ${String(value)} is dropped: ${typed.reason}`,
      );
    } else if (typed.value !== published.default) {
      plan.steps.push(`recognizer config ${published.key} ${typed.value}`);
    }
  } else if (value !== undefined) {
    plan.notes.push(
      `${name}.${found.field} ${JSON.stringify(value)} is dropped: it is not a single value`,
    );
  }

  for (const [field, other] of Object.entries(entry)) {
    if (field !== found.field) {
      plan.notes.push(
        `${name}.${field} ${JSON.stringify(other)} is dropped: no setting replaces it`,
      );
    }
  }

  return plan;
}

function complexitySteps(entry: unknown, document: unknown): Plan {
  const plan: Plan = { steps: [], notes: [] };

  if (at(document, COMPLEXITY_KEY.split(".")) !== undefined) {
    plan.notes.push(`${COMPLEXITY_KEY} is already set and is left alone`);

    return plan;
  }

  if (entry === "off") {
    plan.steps.push(`recognizer config ${COMPLEXITY_SWITCH} false`);

    return plan;
  }

  if (!isPlainObject(entry)) {
    plan.notes.push("complexity had no usable form and is dropped");

    return plan;
  }

  if (isNumber(entry.above)) {
    if (entry.above !== DEFAULT_COMPLEXITY) {
      plan.steps.push(`recognizer config ${COMPLEXITY_KEY} ${entry.above}`);
    }
  } else if ("above" in entry) {
    plan.notes.push(
      `complexity.above ${JSON.stringify(entry.above)} is dropped: it is not a number`,
    );
  }

  if ("below" in entry) {
    plan.notes.push(
      `complexity.below ${JSON.stringify(entry.below)} is dropped: only high complexity is reported`,
    );
  }

  if ("severity" in entry) {
    plan.notes.push("a complexity finding is always a warning now");
  }

  return plan;
}

export function thresholdsMigration(
  document: unknown,
  prefix: (command: string) => string,
  keys: PublishedKeyValues,
): ThresholdsMigration | null {
  const section = at(document, ["sensors", "thresholds"]);

  if (section === undefined) {
    return null;
  }

  const entries = isPlainObject(section) ? section : {};
  const plans: Plan[] = [];

  for (const [name, entry] of Object.entries(entries)) {
    plans.push(
      name === "complexity"
        ? complexitySteps(entry, document)
        : publishedSteps(name, entry, document, keys),
    );
  }

  const steps = [
    ...plans.flatMap((plan) => plan.steps),
    "recognizer config --unset sensors.thresholds",
  ];
  const notes = plans.flatMap((plan) => plan.notes);
  const tail = notes.length === 0 ? "" : `; ${notes.join("; ")}`;

  return {
    line: `config/sensors/thresholds was retired: the thresholds sensor is gone, a coverage sensor now reports low coverage and structural analysis reports complexity; the fix moves what has a replacement and removes the section${tail}`,
    command: steps.map(prefix).join(" && "),
  };
}
