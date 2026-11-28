import type { ConfigRepository } from "../../domain/config-repository.js";
import type { SensorRow } from "../../domain/scan-plan.js";
import type { SensorCatalog } from "./ports/sensor-catalog.js";

export function readSensorRows(
  ports: { config: ConfigRepository; catalog: SensorCatalog },
  root: string,
): SensorRow[] {
  const config = ports.config.sensorConfig(root);
  const suites = (ports.config.tests(config) ?? []).map(
    ({ name, language }) => ({ name, language }),
  );
  const read = ports.catalog.readInstalled();
  const rows: SensorRow[] = read.sensors
    .filter(({ listed }) => listed)
    .sort((a, b) => a.display.localeCompare(b.display))
    .map((one) => ({
      name: one.name,
      display: one.display,
      runsTests: one.runs_tests,
      scoped: one.scoped,
      registered: true,
      ...(one.runs_tests && suites.length > 0 ? { suites } : {}),
    }));
  return rows;
}
