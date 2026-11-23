import { existsSync } from "node:fs";
import { join } from "node:path";

const SENSORS = ["crap", "mutation"];

function requireVenv(repo: string, project: string, binaries: string[]): void {
  const missing = binaries.filter(
    (binary) => !existsSync(join(repo, project, ".venv/bin", binary)),
  );

  if (missing.length > 0) {
    throw new Error(
      `${project}/.venv has no ${missing.join(", ")}: run uv sync --locked --project ${project} (CI runs the same command)`,
    );
  }
}

export function requireSensorsVenv(repo: string): void {
  requireVenv(
    repo,
    "packages/sensors",
    SENSORS.map((name) => `recognizer-sense-${name}`),
  );
}

export function requirePythonScannerVenv(repo: string): void {
  requireVenv(repo, "packages/scanners/python", ["recognizer-scan-python"]);
}
