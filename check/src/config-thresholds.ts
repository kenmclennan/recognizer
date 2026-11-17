interface Migration {
  line: string;
  command: string;
}

const COVERAGE_KEY = "sensors.crap.coverage_limit";
const COMPLEXITY_SWITCH = "sensors.structure.warnings.complexity";
const COMPLEXITY_KEY = `${COMPLEXITY_SWITCH}.limit`;
const DEFAULT_COVERAGE = 0.6;
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

function coverageSteps(entry: unknown, document: unknown): Plan {
  const plan: Plan = { steps: [], notes: [] };

  if (at(document, COVERAGE_KEY.split(".")) !== undefined) {
    plan.notes.push(`${COVERAGE_KEY} is already set and is left alone`);

    return plan;
  }

  if (entry === "off") {
    plan.steps.push(`recognizer config ${COVERAGE_KEY} false`);

    return plan;
  }

  if (!isPlainObject(entry)) {
    plan.notes.push("coverage had no usable form and is dropped");

    return plan;
  }

  const below = entry.below;

  if (isNumber(below) && below > 0 && below <= 1) {
    if (below !== DEFAULT_COVERAGE) {
      plan.steps.push(`recognizer config ${COVERAGE_KEY} ${below}`);
    }
  } else if (below !== undefined) {
    plan.notes.push(
      `coverage.below ${JSON.stringify(below)} is dropped: the limit is a number above 0 and at most 1`,
    );
  }

  if ("above" in entry) {
    plan.notes.push(
      `coverage.above ${JSON.stringify(entry.above)} is dropped: only low coverage is reported`,
    );
  }

  if ("severity" in entry) {
    plan.notes.push("a coverage finding is always a warning now");
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
): Migration | null {
  const section = at(document, ["sensors", "thresholds"]);

  if (section === undefined) {
    return null;
  }

  const entries = isPlainObject(section) ? section : {};
  const plans: Plan[] = [];

  for (const [name, entry] of Object.entries(entries)) {
    if (name === "coverage") {
      plans.push(coverageSteps(entry, document));
    } else if (name === "complexity") {
      plans.push(complexitySteps(entry, document));
    } else {
      plans.push({
        steps: [],
        notes: [`${name} has no replacement and is dropped`],
      });
    }
  }

  const steps = [
    ...plans.flatMap((plan) => plan.steps),
    "recognizer config --unset sensors.thresholds",
  ];
  const notes = plans.flatMap((plan) => plan.notes);
  const tail = notes.length === 0 ? "" : `; ${notes.join("; ")}`;

  return {
    line: `config/sensors/thresholds was retired: the thresholds sensor is gone, C.R.A.P. now reports low coverage and structural analysis reports complexity; the fix moves what has a replacement and removes the section${tail}`,
    command: steps.map(prefix).join(" && "),
  };
}
