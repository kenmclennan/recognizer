import {
  type Config,
  lineStatus,
  parseConfig,
  type Responsibilities,
  validateResponsibilities,
} from "recognizer";

export type ResponsibilityState =
  | { kind: "current"; line: string }
  | {
      kind: "out-of-date";
      line: string;
      reasons: ("source" | "describer" | "version")[];
    }
  | { kind: "missing" }
  | { kind: "unknown"; reason: string };

export type ResponsibilityFiles = {
  responsibilities: string | null;
  config: string | null;
  refused: string[];
  hashes: Record<string, string>;
};

export type DescribeResult = {
  status: "described" | "failed" | "command-missing" | "refused";
  reason?: string;
};

export type ResponsibilityRow = {
  state: ResponsibilityState;
  busy: boolean;
  failure: string | null;
};

export const NO_FILES: ResponsibilityFiles = {
  responsibilities: null,
  config: null,
  refused: [],
  hashes: {},
};

function messageOf(error: unknown): string {
  const details = (error as { messages?: string[] }).messages;

  return details !== undefined && details.length > 0
    ? details.join("; ")
    : (error as Error).message;
}

export function responsibilityStates(
  files: ResponsibilityFiles,
): (id: string) => ResponsibilityState {
  let responsibilities: Responsibilities | null = null;
  let config: Config | null = null;
  let invalid: string | null = null;

  try {
    if (files.responsibilities !== null) {
      responsibilities = validateResponsibilities(
        JSON.parse(files.responsibilities),
      );
    }
  } catch (error) {
    invalid = `responsibilities.json: ${messageOf(error)}`;
  }

  try {
    if (files.config !== null) {
      config = parseConfig(files.config);
    }
  } catch (error) {
    invalid ??= `config.yaml: ${messageOf(error)}`;
  }

  return (id) => {
    if (invalid !== null) {
      return { kind: "unknown", reason: invalid };
    }

    const entry = responsibilities?.modules[id];

    if (entry === undefined) {
      return { kind: "missing" };
    }

    const describer = config?.describer;

    if (describer === undefined) {
      return {
        kind: "out-of-date",
        line: entry.line,
        reasons: ["describer", "version"],
      };
    }

    const hash = files.hashes[id];

    if (hash === undefined) {
      return { kind: "out-of-date", line: entry.line, reasons: ["source"] };
    }

    const status = lineStatus(
      entry,
      hash,
      describer.command,
      describer.version,
    );

    return status.status === "out-of-date"
      ? { kind: "out-of-date", line: entry.line, reasons: status.reasons }
      : { kind: "current", line: entry.line };
  };
}

export type Describing = {
  busy: (id: string) => boolean;
  failure: (id: string) => string | null;
  start: (id: string) => boolean;
  finish: (id: string, result: DescribeResult) => void;
  read: (states: (id: string) => ResponsibilityState) => void;
};

export function createDescribing(): Describing {
  const running = new Set<string>();
  const failures = new Map<string, string>();

  return {
    busy: (id) => running.has(id),
    failure: (id) => failures.get(id) ?? null,
    start(id) {
      if (running.has(id)) {
        return false;
      }

      running.add(id);

      return true;
    },
    finish(id, result) {
      running.delete(id);

      if (result.status === "described") {
        failures.delete(id);
      } else {
        failures.set(id, result.reason ?? "describe failed");
      }
    },
    read(states) {
      for (const id of [...failures.keys()]) {
        if (states(id).kind === "current") {
          failures.delete(id);
        }
      }
    },
  };
}
