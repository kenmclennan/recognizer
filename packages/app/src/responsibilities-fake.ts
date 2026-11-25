import type { ResponsibilitiesPort } from "./responsibilities-port";
import {
  NO_STATES,
  type ResponsibilityRead,
  type ResponsibilityState,
} from "./responsibility-model";

export type FakeResponsibilities = ResponsibilitiesPort & {
  held: ResponsibilityRead;
  reads: number;
  asked: string[][];
  edit(read: ResponsibilityRead): void;
};

export function unknownFor(
  modules: string[],
  reason: string,
): ResponsibilityRead {
  const states: Record<string, ResponsibilityState> = {};

  for (const id of modules) {
    states[id] = { kind: "unknown", reason };
  }

  return { states, describedAtMs: null };
}

export function fakeResponsibilities(
  initial: ResponsibilityRead = NO_STATES,
): FakeResponsibilities {
  const listeners = new Set<() => void>();
  const fake: FakeResponsibilities = {
    held: initial,
    reads: 0,
    asked: [],
    async read(modules) {
      fake.reads += 1;
      fake.asked.push(modules);

      const states: Record<string, ResponsibilityState> = {};

      for (const id of modules) {
        states[id] = fake.held.states[id] ?? { kind: "missing" };
      }

      return { states, describedAtMs: fake.held.describedAtMs };
    },
    onChanged(run) {
      listeners.add(run);

      return () => listeners.delete(run);
    },
    edit(read) {
      fake.held = read;

      for (const run of listeners) {
        run();
      }
    },
  };

  return fake;
}
