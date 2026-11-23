import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ShippedSensor } from "./sensor-run";

const EXAMPLES = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../schema/manifest-examples/valid",
);

const SENSOR_EXAMPLE = /^sensor-(.+)\.json$/;

export function shippedNames(): string[] {
  return readdirSync(EXAMPLES)
    .map((file) => SENSOR_EXAMPLE.exec(file)?.[1])
    .filter((name): name is string => name !== undefined)
    .sort();
}

type ManifestDocument = Omit<
  ShippedSensor,
  "runsTests" | "listed" | "plannedWork" | "logPath"
> & {
  runs_tests: boolean;
  planned_work?: { verb: string };
  log_path?: string;
};

export function shippedSensor(name: string): ShippedSensor {
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

export function shippedSensors(): ShippedSensor[] {
  return shippedNames().map(shippedSensor);
}

export function plainSensor(
  name: string,
  over: Partial<ShippedSensor> = {},
): ShippedSensor {
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
