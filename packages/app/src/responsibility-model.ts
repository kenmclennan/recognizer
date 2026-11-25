export type ResponsibilityState =
  | { kind: "current"; line: string }
  | {
      kind: "out-of-date";
      line: string;
      reasons: ("source" | "describer" | "version")[];
    }
  | { kind: "missing" }
  | { kind: "unknown"; reason: string };

export type ResponsibilityRead = {
  states: Record<string, ResponsibilityState>;
  describedAtMs: number | null;
};

export type DescribeResult = {
  status: "described" | "failed" | "command-missing" | "refused";
  reason?: string;
};

export type ResponsibilityRow = {
  state: ResponsibilityState;
  failure: string | null;
};

export const NO_STATES: ResponsibilityRead = {
  states: {},
  describedAtMs: null,
};

export function stateOf(
  read: ResponsibilityRead,
): (id: string) => ResponsibilityState {
  return (id) => read.states[id] ?? { kind: "missing" };
}

export type Describing = {
  failure: (id: string) => string | null;
  finish: (id: string, result: DescribeResult) => void;
  read: (states: (id: string) => ResponsibilityState) => void;
};

export function createDescribing(): Describing {
  const failures = new Map<string, string>();

  return {
    failure: (id) => failures.get(id) ?? null,
    finish(id, result) {
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
