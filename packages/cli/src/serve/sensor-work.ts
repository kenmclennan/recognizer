import { requestFaults } from "@recognizer/core";
import { sinkIo } from "../adapters/plugins/sink-io.js";
import type { Io } from "../cli.js";
import { InputError } from "../errors.js";
import { runSensors } from "../sensors-command.js";
import { writeScopeFiles } from "./scan-files.js";

export interface PlannedWork {
  unit: string;
  to_perform: number;
}

export function plannedWorkFrom(stdout: string): PlannedWork | null {
  let document: unknown;

  try {
    document = JSON.parse(stdout);
  } catch {
    return null;
  }

  const work = (
    document as {
      sensors?: { work?: { unit?: unknown; to_perform?: unknown } }[];
    }
  )?.sensors?.[0]?.work;

  if (
    typeof work?.unit !== "string" ||
    work.unit === "" ||
    typeof work.to_perform !== "number" ||
    !Number.isInteger(work.to_perform) ||
    work.to_perform < 0
  ) {
    return null;
  }

  return { unit: work.unit, to_perform: work.to_perform };
}

export function workArgs(
  repository: string,
  sensor: string,
  modulesFile: string | undefined,
  suitesFile: string | undefined,
): string[] {
  return [
    "check",
    sensor,
    "--work",
    "--json",
    "--repository",
    repository,
    ...(modulesFile === undefined ? [] : ["--modules", modulesFile]),
    ...(suitesFile === undefined ? [] : ["--suites", suitesFile]),
  ];
}

export function sensorWork(
  io: Io,
  repository: string,
  sensor: string,
  modules: string[] | undefined,
  suites: string[] | undefined,
): PlannedWork | null {
  const faults = requestFaults({
    repository,
    mode: "incremental",
    sensors: [{ name: sensor, ...(suites === undefined ? {} : { suites }) }],
    describe: false,
    analysis: false,
    ...(modules === undefined ? {} : { modules: { file: "", names: modules } }),
    ignoreRetiredConfig: false,
    invocation: [],
  });

  if (faults.length > 0) {
    throw new InputError(faults);
  }

  const files = writeScopeFiles(repository, "work", modules, suites);
  let out = "";

  try {
    const status = runSensors(
      workArgs(repository, sensor, files.modules, files.suites),
      sinkIo(io, (stream, chunk) => {
        if (stream === "stdout") {
          out += chunk;
        }
      }),
    );

    return status === 0 || status === 1 ? plannedWorkFrom(out) : null;
  } catch {
    return null;
  } finally {
    files.remove();
  }
}
