import { InvalidRequest } from "../invalid-request.js";

export function parseSuiteSelection(
  text: string,
  configured: readonly string[],
  sensors: readonly { name: string; runsTests: boolean }[],
): Record<string, string[]> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new InvalidRequest([
      `--suites file is not valid JSON: ${(error as Error).message}`,
    ]);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new InvalidRequest([
      "--suites file must be a JSON object from sensor name to an array of suite names",
    ]);
  }

  const result: Record<string, string[]> = {};

  for (const [name, value] of Object.entries(parsed)) {
    const sensor = sensors.find((one) => one.name === name);

    if (sensor === undefined) {
      throw new InvalidRequest([
        `--suites names ${name}, which is not selected`,
      ]);
    }

    if (!sensor.runsTests) {
      throw new InvalidRequest([`--suites names ${name}, which runs no tests`]);
    }

    if (
      !Array.isArray(value) ||
      value.some((one) => typeof one !== "string" || one === "")
    ) {
      throw new InvalidRequest([
        `--suites ${name} must be an array of non-empty suite names`,
      ]);
    }

    if (value.length === 0) {
      throw new InvalidRequest([
        `--suites ${name} must name at least one suite`,
      ]);
    }

    const unknown = (value as string[]).filter(
      (one) => !configured.includes(one),
    );

    if (unknown.length > 0) {
      throw new InvalidRequest([
        ...unknown.map((one) => `--suites ${name}: no such suite: ${one}`),
        `configured suites: ${configured.join(", ")}`,
      ]);
    }

    result[name] = [...new Set(value as string[])];
  }

  return result;
}
