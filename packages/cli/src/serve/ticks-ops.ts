import {
  afterTickChanges,
  type ScanTicks,
  type TickChange,
} from "@recognizer/core";
import { ArgsError } from "./wire.js";

function recordOf(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ArgsError([`${name} must be an object`]);
  }

  return value as Record<string, unknown>;
}

function namesOf(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((one) => typeof one !== "string")) {
    throw new ArgsError([`${name} must be a list of names`]);
  }

  return value as string[];
}

function flagOf(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") {
    throw new ArgsError([`${name} must be true or false`]);
  }

  return value;
}

function nameOf(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new ArgsError([`${name} must be text`]);
  }

  return value;
}

export function ticksOf(value: unknown): ScanTicks {
  const given = recordOf(value, "ticks");
  const suites = recordOf(given.suites, "ticks.suites");
  const entries: ScanTicks["suites"] = {};

  for (const [sensor, entry] of Object.entries(suites)) {
    const one = recordOf(entry, "ticks.suites");

    entries[sensor] = {
      ticked: namesOf(one.ticked, "ticks.suites.ticked"),
      known: namesOf(one.known, "ticks.suites.known"),
    };
  }

  return {
    describe: flagOf(given.describe, "ticks.describe"),
    analysis: flagOf(given.analysis, "ticks.analysis"),
    ticked:
      given.ticked === null ? null : namesOf(given.ticked, "ticks.ticked"),
    armed: namesOf(given.armed, "ticks.armed"),
    onlyView: flagOf(given.onlyView, "ticks.onlyView"),
    suites: entries,
    folds: namesOf(given.folds, "ticks.folds"),
  };
}

export function changeOf(value: unknown): TickChange {
  const given = recordOf(value, "changes");

  switch (given.kind) {
    case "describe":
    case "analysis":
      return {
        kind: given.kind,
        ticked: flagOf(given.ticked, "ticked"),
      };
    case "onlyView":
      return { kind: "onlyView", on: flagOf(given.on, "on") };
    case "fold":
      return { kind: "fold", sensor: nameOf(given.sensor, "sensor") };
    case "open":
      return { kind: "open" };
    case "sensor":
      return {
        kind: "sensor",
        sensor: nameOf(given.sensor, "sensor"),
        ticked: flagOf(given.ticked, "ticked"),
        suites: namesOf(given.suites, "suites"),
      };
    case "suite":
      return {
        kind: "suite",
        sensor: nameOf(given.sensor, "sensor"),
        suite: nameOf(given.suite, "suite"),
        ticked: flagOf(given.ticked, "ticked"),
        suites: namesOf(given.suites, "suites"),
      };
    case "plain":
      return {
        kind: "plain",
        sensor: nameOf(given.sensor, "sensor"),
        ticked: flagOf(given.ticked, "ticked"),
        plain: namesOf(given.plain, "plain"),
      };
    default:
      throw new ArgsError(["a change names a kind of tick change"]);
  }
}

export function changeTicks(args: Record<string, unknown>): ScanTicks {
  if (!Array.isArray(args.changes)) {
    throw new ArgsError(["changes must be a list"]);
  }

  return afterTickChanges(ticksOf(args.ticks), args.changes.map(changeOf));
}
