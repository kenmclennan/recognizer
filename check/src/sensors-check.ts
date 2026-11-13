import type { Io } from "./cli.js";
import { readConfig } from "./config.js";
import { registeredSensors } from "./config-parse.js";
import { readManifestOf } from "./plugin-manifest.js";
import { pluginPrefix } from "./plugin-run.js";
import { selectSensors } from "./scan-phases.js";
import {
  type ManifestReader,
  readShippedSensors,
  shippedSensorNames,
  shippedSensorOf,
} from "./shipped-sensors.js";

export interface SensorGap {
  code: string;
  suite: string | null;
  line: string;
}

export type SensorNote = SensorGap;

export interface SensorReport {
  name: string;
  ready: boolean;
  checked: boolean;
  gaps: SensorGap[];
  notes: SensorNote[];
}

export interface CheckableSensor {
  name: string;
  command: string[];
}

export const CHECK_TIMEOUT_MS = 600_000;

function checkable(command: readonly string[]): boolean {
  return (
    pluginPrefix(command) !== null && shippedSensorOf(command) !== undefined
  );
}

function notInstalled(command: readonly string[]): string {
  return `${command[0]} is not installed`;
}

const DROPPED_PAIRS = ["--commit", "--output", "--modules", "--suites"];

function isSensorGap(value: unknown): value is SensorGap {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const gap = value as Record<string, unknown>;

  return (
    typeof gap.code === "string" &&
    typeof gap.line === "string" &&
    (gap.suite === null || typeof gap.suite === "string")
  );
}

function entries(value: unknown): SensorGap[] | null {
  return Array.isArray(value) && value.every(isSensorGap)
    ? value.map(({ code, suite, line }) => ({ code, suite, line }))
    : null;
}

function parseAnswer(
  stdout: string,
): { gaps: SensorGap[]; notes: SensorNote[] } | null {
  const last = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .pop();

  if (last === undefined) {
    return null;
  }

  try {
    const parsed = JSON.parse(last) as { gaps?: unknown; notes?: unknown };
    const gaps = entries(parsed.gaps);
    const notes = parsed.notes === undefined ? [] : entries(parsed.notes);

    return gaps === null || notes === null ? null : { gaps, notes };
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

function afterRun(command: string[]): { prefix: string[]; rest: string[] } {
  const at = command.indexOf("run");

  return { prefix: command.slice(0, at), rest: command.slice(at + 1) };
}

export function checkArguments(
  command: string[],
  root: string,
  run: boolean,
): string[] {
  const { prefix, rest } = afterRun(command);

  return [
    ...prefix,
    "check",
    ...strippedArguments(rest, root, ["--suites"]),
    ...(run ? ["--run"] : []),
  ];
}

export function guideText(
  io: Io,
  root: string,
  sensor: CheckableSensor,
): { text: string } | { failure: string } {
  if (!checkable(sensor.command)) {
    return { text: "" };
  }

  const { prefix } = afterRun(sensor.command);
  const result = io.run(prefix[0] as string, [...prefix.slice(1), "guide"], {
    cwd: root,
  });

  if (!result.started) {
    return { failure: notInstalled(sensor.command) };
  }

  if (result.status !== 0) {
    return {
      failure:
        firstLine(result.stderr) ?? `${sensor.name} exited ${result.status}`,
    };
  }

  return { text: result.stdout };
}

function unanswered(name: string, why: string): SensorReport {
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

function firstLine(text: string): string | undefined {
  return text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "");
}

export function checkSensor(
  io: Io,
  root: string,
  sensor: CheckableSensor,
  run: boolean,
  read: ManifestReader = (prefix) => readManifestOf(io, prefix),
): SensorReport {
  if (!checkable(sensor.command)) {
    return {
      name: sensor.name,
      ready: true,
      checked: false,
      gaps: [],
      notes: [],
    };
  }

  const declared = read(
    afterRun(sensor.command).prefix.map((item) =>
      item.split("{repository}").join(root),
    ),
  );

  if (declared.ok && !declared.manifest.check) {
    return {
      name: sensor.name,
      ready: true,
      checked: true,
      gaps: [],
      notes: [],
    };
  }

  const [program, ...rest] = checkArguments(sensor.command, root, run) as [
    string,
    ...string[],
  ];
  const result = io.run(program, rest, {
    cwd: root,
    ...(run ? {} : { timeoutMs: CHECK_TIMEOUT_MS }),
  });

  if (!result.started) {
    return {
      name: sensor.name,
      ready: false,
      checked: true,
      gaps: [
        {
          code: "sensors-missing",
          suite: null,
          line: notInstalled(sensor.command),
        },
      ],
      notes: [],
    };
  }

  if (result.timedOut === true) {
    return unanswered(sensor.name, "it timed out");
  }

  if (result.status !== 0) {
    return unanswered(
      sensor.name,
      firstLine(result.stderr) ?? `exit status ${result.status}`,
    );
  }

  const answer = parseAnswer(result.stdout);

  if (answer === null) {
    return unanswered(
      sensor.name,
      firstLine(result.stderr) ?? "it printed no readable gaps",
    );
  }

  return {
    name: sensor.name,
    ready: answer.gaps.length === 0,
    checked: true,
    gaps: answer.gaps,
    notes: answer.notes,
  };
}

export function checkSensors(
  io: Io,
  root: string,
  sensors: CheckableSensor[],
  run: boolean,
  read?: ManifestReader,
): SensorReport[] {
  return sensors.map((sensor) => checkSensor(io, root, sensor, run, read));
}

export function reportText(reports: SensorReport[]): string {
  return `${reports
    .flatMap((report) => {
      if (!report.checked) {
        return [`${report.name}: no readiness check`];
      }

      const notes = report.notes.map((note) => `  ${note.line}`);

      if (report.ready) {
        return [`${report.name}: ready`, ...notes];
      }

      const count = report.gaps.length;

      return [
        `${report.name}: ${count} ${count === 1 ? "gap" : "gaps"}`,
        ...report.gaps.map((gap) => `  ${gap.line}`),
        ...notes,
      ];
    })
    .join("\n")}\n`;
}

export function reportJson(reports: SensorReport[]): string {
  return `${JSON.stringify(
    {
      ready: reports.every((report) => report.ready),
      sensors: reports.map(({ name, ready, gaps, notes }) => ({
        name,
        ready,
        gaps,
        notes,
      })),
    },
    null,
    2,
  )}\n`;
}

export function sensorsToCheck(
  io: Io,
  root: string,
  name: string | undefined,
  withSuites = true,
): CheckableSensor[] {
  const config = readConfig(io, root, ["sensors"]);
  const registered = registeredSensors(config);

  if (!withSuites) {
    return selectSensors(
      registered,
      name === undefined ? "all" : [name],
      shippedSensorNames(),
    );
  }

  const wanted = new Set<string>(name === undefined ? [] : [name]);

  for (const one of registered) {
    const shipped = shippedSensorOf(one.command);

    if (shipped !== undefined) {
      wanted.add(shipped);
    }
  }

  return selectSensors(
    registered,
    name === undefined ? "all" : [name],
    shippedSensorNames(),
    config?.tests,
    readShippedSensors(io, undefined, [...wanted]),
  );
}
