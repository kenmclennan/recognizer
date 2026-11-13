import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ShippedSensor } from "./sensor-run";

const EXAMPLES = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../schema/manifest-examples/valid",
);

export const SHIPPED_NAMES = ["crap", "mutation", "thresholds"];

type ManifestDocument = Omit<ShippedSensor, "runsTests" | "listed"> & {
  runs_tests: boolean;
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
    runsTests: runs_tests,
    scoped: rest.scoped,
    listed: rest.metrics.length > 0,
    metrics: rest.metrics,
    findings: rest.findings,
    settings: rest.settings,
  };
}

export function shippedSensors(): ShippedSensor[] {
  return SHIPPED_NAMES.map(shippedSensor);
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
