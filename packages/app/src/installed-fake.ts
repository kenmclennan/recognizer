import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { InstalledSensor } from "./sensor-run";

const EXAMPLES = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../schema/manifest-examples/valid",
);

const SENSOR_EXAMPLE = /^sensor-(.+)\.json$/;

export function installedNames(): string[] {
  return readdirSync(EXAMPLES)
    .map((file) => SENSOR_EXAMPLE.exec(file)?.[1])
    .filter((name): name is string => name !== undefined)
    .sort();
}

type ManifestDocument = Omit<
  InstalledSensor,
  "runsTests" | "listed" | "plannedWork" | "logPath"
> & {
  runs_tests: boolean;
  planned_work?: { verb: string };
  log_path?: string;
};

export function installedSensor(name: string): InstalledSensor {
  const { runs_tests, ...rest } = JSON.parse(
    readFileSync(join(EXAMPLES, `sensor-${name}.json`), "utf8"),
  ) as ManifestDocument;

  return {
    name: rest.name,
    display: rest.display,
    description: rest.description,
    ...(rest.expansion === undefined ? {} : { expansion: rest.expansion }),
    ...(rest.settings_title === undefined
      ? {}
      : { settings_title: rest.settings_title }),
    runsTests: runs_tests,
    scoped: rest.scoped,
    ...(rest.planned_work === undefined
      ? {}
      : { plannedWork: rest.planned_work }),
    ...(rest.log_path === undefined ? {} : { logPath: rest.log_path }),
    listed: rest.metrics.length > 0,
    metrics: rest.metrics,
    findings: rest.findings,
    settings: rest.settings,
  };
}

export function installedSensors(): InstalledSensor[] {
  return installedNames().map(installedSensor);
}

export function plainSensor(
  name: string,
  over: Partial<InstalledSensor> = {},
): InstalledSensor {
  return {
    name,
    display: name,
    description: "",
    runsTests: false,
    scoped: false,
    listed: true,
    metrics: [],
    findings: [],
    settings: [],
    ...over,
  };
}
