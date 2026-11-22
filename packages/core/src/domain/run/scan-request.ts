import type { ScopeFile, SensorRequest } from "../sensor-request.js";

export type ScanMode = "incremental" | "full";

export type DescribeIntent = false | "stale" | "all";

export interface ScanRequest {
  repository: string;
  mode: ScanMode;
  sensors: null | "all" | SensorRequest[];
  describe: DescribeIntent;
  analysis: boolean;
  confirmAbove?: number;
  modules?: ScopeFile;
  by?: string;
  ignoreRetiredConfig: boolean;
  suitesFile?: string;
  invocation: string[];
}

export class InvalidRequest extends Error {
  readonly messages: string[];

  constructor(messages: string[]) {
    super(messages.join("\n"));
    this.name = "InvalidRequest";
    this.messages = messages;
  }
}

const NAME_LIMIT = 200;

export function sensorNameOk(name: string): boolean {
  return /^[a-z0-9][a-z0-9_-]*$/.test(name);
}

export function requestFaults(request: ScanRequest): string[] {
  const faults: string[] = [];
  const names = request.modules?.names;

  if (names !== undefined) {
    if (names.length === 0) {
      faults.push("the module scope is empty");
    } else if (names.some((id) => id === "")) {
      faults.push("a module id in the scope is empty");
    } else if (names.some((id) => id.includes("\0"))) {
      faults.push("a module id in the scope holds a NUL");
    }
  }

  if (Array.isArray(request.sensors)) {
    const unfit = request.sensors.find(
      (one) => !sensorNameOk(one.name) || one.name.length > NAME_LIMIT,
    );

    if (unfit !== undefined) {
      faults.push(`${unfit.name} is not a sensor name`);
    }

    for (const one of request.sensors) {
      if (one.suites === undefined) {
        continue;
      }

      if (one.suites.length === 0) {
        faults.push("a sensor's suite list is empty");
      } else if (
        one.suites.some(
          (name) =>
            name === "" || [...name].length > NAME_LIMIT || name.includes("\0"),
        )
      ) {
        faults.push(
          "a suite name is empty, over 200 characters or holds a NUL",
        );
      }
    }
  }

  return faults;
}
