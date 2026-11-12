import type { Io } from "./cli.js";
import { readConfig } from "./config.js";
import { registeredSensors } from "./config-parse.js";
import { selectSensors } from "./scan-phases.js";
import { shippedSensorNames } from "./shipped-sensors.js";

export interface SensorGap {
  code: string;
  suite: string | null;
  line: string;
}

export interface SensorReport {
  name: string;
  ready: boolean;
  checked: boolean;
  gaps: SensorGap[];
}

export interface CheckableSensor {
  name: string;
  command: string[];
}

export const CHECK_TIMEOUT_MS = 600_000;

const SENSORS_PROGRAM = "recognizer-sensors";

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

function parseGaps(stdout: string): SensorGap[] | null {
  const last = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .pop();

  if (last === undefined) {
    return null;
  }

  try {
    const parsed = JSON.parse(last) as { gaps?: unknown };

    return Array.isArray(parsed.gaps) && parsed.gaps.every(isSensorGap)
      ? parsed.gaps.map(({ code, suite, line }) => ({ code, suite, line }))
      : null;
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

export function checkArguments(
  command: string[],
  root: string,
  run: boolean,
): string[] {
  return [
    ...strippedArguments(command, root, ["--suites"]),
    "--check",
    ...(run ? ["--run"] : []),
  ];
}

export function guideText(
  io: Io,
  root: string,
  sensor: CheckableSensor,
): { text: string } | { failure: string } {
  if (sensor.command[0] !== SENSORS_PROGRAM) {
    return { text: "" };
  }

  const full = [...strippedArguments(sensor.command, root), "--guide"];
  const program = full[0] as string;
  const rest = full.slice(1);
  const result = io.run(program, rest, { cwd: root });

  if (!result.started) {
    return { failure: `${SENSORS_PROGRAM} is not installed` };
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
): SensorReport {
  if (sensor.command[0] !== SENSORS_PROGRAM) {
    return { name: sensor.name, ready: true, checked: false, gaps: [] };
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
          line: `${SENSORS_PROGRAM} is not installed`,
        },
      ],
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

  const gaps = parseGaps(result.stdout);

  if (gaps === null) {
    return unanswered(
      sensor.name,
      firstLine(result.stderr) ?? "it printed no readable gaps",
    );
  }

  return { name: sensor.name, ready: gaps.length === 0, checked: true, gaps };
}

export function checkSensors(
  io: Io,
  root: string,
  sensors: CheckableSensor[],
  run: boolean,
): SensorReport[] {
  return sensors.map((sensor) => checkSensor(io, root, sensor, run));
}

export function reportText(reports: SensorReport[]): string {
  return `${reports
    .flatMap((report) => {
      if (!report.checked) {
        return [`${report.name}: no readiness check`];
      }

      if (report.ready) {
        return [`${report.name}: ready`];
      }

      const count = report.gaps.length;

      return [
        `${report.name}: ${count} ${count === 1 ? "gap" : "gaps"}`,
        ...report.gaps.map((gap) => `  ${gap.line}`),
      ];
    })
    .join("\n")}\n`;
}

export function reportJson(reports: SensorReport[]): string {
  return `${JSON.stringify(
    {
      ready: reports.every((report) => report.ready),
      sensors: reports.map(({ name, ready, gaps }) => ({ name, ready, gaps })),
    },
    null,
    2,
  )}\n`;
}

export function sensorsToCheck(
  io: Io,
  root: string,
  name: string | undefined,
): CheckableSensor[] {
  const config = readConfig(io, root);

  return selectSensors(
    registeredSensors(config),
    name === undefined ? "all" : [name],
    shippedSensorNames(),
    config?.tests,
  );
}
