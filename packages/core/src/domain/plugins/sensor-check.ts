export interface SensorGap {
  code: string;
  suite: string | null;
  line: string;
  output?: string;
}

export type SensorNote = SensorGap;

export interface ReadinessWork {
  unit: string;
  to_perform: number;
  reusable: number;
}

export interface SensorReport {
  name: string;
  ready: boolean;
  checked: boolean;
  gaps: SensorGap[];
  notes: SensorNote[];
  work?: ReadinessWork;
}

export interface CheckOptions {
  run?: boolean;
  work?: boolean;
  modules?: string;
  suites?: string;
}

export interface CheckableSensor {
  name: string;
  command: string[];
}

export const CHECK_TIMEOUT_MS = 600_000;

const DROPPED_PAIRS = ["--commit", "--output", "--modules", "--suites"];

function programName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function checkable(command: readonly string[]): boolean {
  return (
    splitAtRun(command) !== null &&
    /^recognizer-sense-./.test(programName(command[0] ?? ""))
  );
}

export function notInstalled(command: readonly string[]): string {
  return `${command[0]} is not installed`;
}

export function firstLine(text: string): string | undefined {
  return text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "");
}

function isSensorGap(value: unknown): value is SensorGap {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const gap = value as Record<string, unknown>;

  return (
    typeof gap.code === "string" &&
    typeof gap.line === "string" &&
    (gap.suite === null || typeof gap.suite === "string") &&
    (gap.output === undefined || typeof gap.output === "string")
  );
}

function entries(value: unknown): SensorGap[] | null {
  return Array.isArray(value) && value.every(isSensorGap)
    ? value.map(({ code, suite, line, output }) => ({
        code,
        suite,
        line,
        ...(output === undefined ? {} : { output }),
      }))
    : null;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function workOf(value: unknown): ReadinessWork | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const work = value as Record<string, unknown>;

  return typeof work.unit === "string" &&
    work.unit !== "" &&
    isCount(work.to_perform) &&
    isCount(work.reusable)
    ? {
        unit: work.unit,
        to_perform: work.to_perform,
        reusable: work.reusable,
      }
    : undefined;
}

export function parseAnswer(
  stdout: string,
): { gaps: SensorGap[]; notes: SensorNote[]; work?: ReadinessWork } | null {
  const last = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .pop();

  if (last === undefined) {
    return null;
  }

  try {
    const parsed = JSON.parse(last) as {
      gaps?: unknown;
      notes?: unknown;
      work?: unknown;
    };
    const gaps = entries(parsed.gaps);
    const notes = parsed.notes === undefined ? [] : entries(parsed.notes);
    const work = workOf(parsed.work);

    return gaps === null || notes === null
      ? null
      : { gaps, notes, ...(work === undefined ? {} : { work }) };
  } catch {
    return null;
  }
}

export function strippedArguments(
  command: string[],
  root: string,
  keep: readonly string[] = [],
): string[] {
  const kept: string[] = [];

  for (let at = 0; at < command.length; at += 1) {
    const item = command[at] as string;

    if (DROPPED_PAIRS.includes(item) && !keep.includes(item)) {
      at += 1;

      continue;
    }

    kept.push(item.split("{repository}").join(root));
  }

  return kept;
}

export const NO_RUN_LINE =
  "the describer does not speak the plugin verbs: its command has no run element";

export function splitAtRun(
  command: readonly string[],
): { prefix: string[]; rest: string[] } | null {
  const at = command.indexOf("run");

  return at === -1
    ? null
    : { prefix: command.slice(0, at), rest: command.slice(at + 1) };
}

export function checkArguments(
  command: string[],
  root: string,
  run: boolean,
  options: Pick<CheckOptions, "work" | "modules" | "suites"> = {},
): string[] {
  const { prefix, rest } = splitAtRun(command) ?? { prefix: [], rest: [] };

  return [
    ...prefix,
    "check",
    ...strippedArguments(rest, root, ["--suites"]),
    ...(run ? ["--run"] : []),
    ...(options.work === true ? ["--work"] : []),
    ...(options.modules === undefined ? [] : ["--modules", options.modules]),
    ...(options.suites === undefined ? [] : ["--suites", options.suites]),
  ];
}

export function unanswered(name: string, why: string): SensorReport {
  return {
    name,
    ready: false,
    checked: true,
    gaps: [
      {
        code: "check-failed",
        suite: null,
        line: `the readiness check of ${name} did not answer: ${why}`,
      },
    ],
    notes: [],
  };
}
