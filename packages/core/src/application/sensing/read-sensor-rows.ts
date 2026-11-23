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
  const names = new Set(
    ports.config.registeredSensors(config).map(({ name }) => name),
  );
  const shipped = ports.catalog.readShipped();
  const rows: SensorRow[] = shipped.sensors
    .filter(({ listed }) => listed)
    .sort((a, b) => a.display.localeCompare(b.display))
    .map((one) => ({
      name: one.name,
      display: one.display,
      runsTests: one.runs_tests,
      scoped: one.scoped,
      registered: names.has(one.name),
      ...(one.runs_tests && suites.length > 0 ? { suites } : {}),
    }));
  const known = new Set(ports.catalog.shippedNames());

  for (const name of names) {
    if (!known.has(name)) {
      rows.push({
        name,
        display: name,
        runsTests: false,
        scoped: false,
        registered: true,
      });
    }
  }

  return rows;
}
