import {
  afterRun,
  CHECK_TIMEOUT_MS,
  type CheckableSensor,
  type CheckOptions,
  checkArguments,
  checkable,
  firstLine,
  notInstalled,
  parseAnswer,
  type SensorReport,
  unanswered,
} from "../../domain/plugins/sensor-check.js";
import type { PluginPorts } from "./internal/plugin-ports.js";
import { readManifestOf } from "./read-manifest.js";
import type { ManifestReader } from "./shipped-plugins.js";

export type { SensorReport };

type CheckPorts = Pick<PluginPorts, "programs" | "validators">;

export function checkSensor(
  ports: CheckPorts,
  root: string,
  sensor: CheckableSensor,
  options: CheckOptions,
  read: ManifestReader = (prefix) => readManifestOf(ports, prefix),
): SensorReport {
  const run = options.run === true;

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

  const [program, ...rest] = checkArguments(
    sensor.command,
    root,
    run,
    options,
  ) as [string, ...string[]];
  const result = ports.programs.run(program, rest, {
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
    ...(answer.work === undefined ? {} : { work: answer.work }),
  };
}

export function checkSensors(
  ports: CheckPorts,
  root: string,
  sensors: CheckableSensor[],
  options: CheckOptions,
  read?: ManifestReader,
): SensorReport[] {
  return sensors.map((sensor) =>
    checkSensor(ports, root, sensor, options, read),
  );
}

export function guideSensor(
  ports: Pick<PluginPorts, "programs">,
  root: string,
  sensor: CheckableSensor,
): { text: string } | { failure: string } {
  if (!checkable(sensor.command)) {
    return { text: "" };
  }

  const { prefix } = afterRun(sensor.command);
  const result = ports.programs.run(
    prefix[0] as string,
    [...prefix.slice(1), "guide"],
    { cwd: root },
  );

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
