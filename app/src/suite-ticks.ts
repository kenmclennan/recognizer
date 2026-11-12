import type { ScanTicks } from "./scan-panel-model";

export type SuiteRef = { name: string; language: string };

export type SuiteTickEntry = { ticked: string[]; known: string[] };

export type TickState = "off" | "some" | "on";

export const EMPTY_SUITE_TICKS: Pick<ScanTicks, "suites" | "folds"> = {
  suites: {},
  folds: [],
};

export function suiteIsTicked(
  suites: ScanTicks["suites"],
  sensor: string,
  suite: string,
): boolean {
  const entry = suites[sensor];

  if (entry === undefined) {
    return false;
  }

  return entry.ticked.includes(suite) || !entry.known.includes(suite);
}

export function tickedSuites(
  suites: ScanTicks["suites"],
  sensor: string,
  all: string[],
): string[] {
  return all.filter((name) => suiteIsTicked(suites, sensor, name));
}

export function sensorTickState(
  ticks: Pick<ScanTicks, "suites" | "once">,
  sensor: string,
  all: string[],
): TickState {
  const ticked = tickedSuites(ticks.suites, sensor, all);

  if (!ticks.once.includes(sensor) || ticked.length === 0) {
    return "off";
  }

  return ticked.length === all.length ? "on" : "some";
}

function withSuites(
  ticks: ScanTicks,
  sensor: string,
  ticked: string[],
  all: string[],
): ScanTicks {
  return {
    ...ticks,
    suites: { ...ticks.suites, [sensor]: { ticked, known: [...all] } },
  };
}

export function afterSensorTick(
  ticks: ScanTicks,
  sensor: string,
  all: string[],
): ScanTicks {
  if (sensorTickState(ticks, sensor, all) !== "off") {
    return { ...ticks, once: ticks.once.filter((name) => name !== sensor) };
  }

  const armed = {
    ...ticks,
    once: [...ticks.once.filter((name) => name !== sensor), sensor],
  };

  return tickedSuites(ticks.suites, sensor, all).length === 0
    ? withSuites(armed, sensor, [...all], all)
    : armed;
}

export function afterSuiteTick(
  ticks: ScanTicks,
  sensor: string,
  suite: string,
  ticked: boolean,
  all: string[],
): ScanTicks {
  const current = tickedSuites(ticks.suites, sensor, all).filter(
    (name) => name !== suite,
  );
  const next = ticked ? [...current, suite] : current;
  const order = all.filter((name) => next.includes(name));
  const written = withSuites(ticks, sensor, order, all);

  return ticked && !ticks.once.includes(sensor)
    ? { ...written, once: [...ticks.once, sensor] }
    : written;
}

export function afterFoldToggle(ticks: ScanTicks, sensor: string): ScanTicks {
  return {
    ...ticks,
    folds: ticks.folds.includes(sensor)
      ? ticks.folds.filter((name) => name !== sensor)
      : [...ticks.folds, sensor],
  };
}

export function suitePlan(
  ticks: Pick<ScanTicks, "suites">,
  sensors: { name: string; suites?: SuiteRef[] }[],
  armed: string[],
): { sense: string[]; suites: Record<string, string[]> } {
  const suites: Record<string, string[]> = {};
  const sense: string[] = [];

  for (const sensor of sensors) {
    const names = (sensor.suites ?? []).map(({ name }) => name);

    if (names.length === 0) {
      if (armed.includes(sensor.name)) {
        sense.push(sensor.name);
      }

      continue;
    }

    const ticked = tickedSuites(ticks.suites, sensor.name, names);

    if (armed.includes(sensor.name) && ticked.length > 0) {
      sense.push(sensor.name);
      suites[sensor.name] = ticked;
    }
  }

  return { sense, suites };
}

export function sensorArmed(
  ticks: Pick<ScanTicks, "suites" | "once">,
  sensor: { name: string; suites?: SuiteRef[] },
): boolean {
  const names = (sensor.suites ?? []).map(({ name }) => name);

  return names.length === 0
    ? ticks.once.includes(sensor.name)
    : sensorTickState(ticks, sensor.name, names) !== "off";
}
