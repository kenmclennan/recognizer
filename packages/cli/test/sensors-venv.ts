import { existsSync } from "node:fs";
import { join } from "node:path";

const SENSORS = ["crap", "mutation"];

export function requireSensorsVenv(repo: string): void {
  const missing = SENSORS.map((name) => `recognizer-sense-${name}`).filter(
    (binary) => !existsSync(join(repo, "packages/sensors/.venv/bin", binary)),
  );

  if (missing.length > 0) {
    throw new Error(
      `packages/sensors/.venv has no ${missing.join(", ")}: run uv sync --locked --project packages/sensors (CI runs the same command)`,
    );
  }
}
