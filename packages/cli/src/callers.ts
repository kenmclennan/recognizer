import { moduleLabel } from "./neighbours.js";
import type { Scan, ScanCall } from "./scan.js";

export type Caller = { module: string; through: string | null };

export type CallerSummary = { callers: Caller[]; constructed: boolean };

export type CallerIndex = {
  known: (module: string) => boolean;
  of: (module: string, qualified: string) => CallerSummary;
};

function moduleOf(ref: string): string {
  return ref.slice(0, ref.indexOf("::"));
}

function classPart(ref: string): string {
  const name = ref.slice(ref.indexOf("::") + 2);
  const dot = name.lastIndexOf(".");

  return dot < 0 ? name : name.slice(0, dot);
}

function byLabel(a: Caller, b: Caller): number {
  return (
    moduleLabel(a.module).localeCompare(moduleLabel(b.module)) ||
    a.module.localeCompare(b.module)
  );
}

export function buildCallerIndex(scans: Scan[]): CallerIndex {
  const into = new Map<string, ScanCall[]>();
  const knownModules = new Set<string>();

  for (const scan of scans) {
    if (scan.calls === undefined) {
      continue;
    }

    for (const module of scan.modules) {
      knownModules.add(module.id);
    }

    for (const call of scan.calls) {
      into.set(call.to, [...(into.get(call.to) ?? []), call]);
    }
  }

  function callersOf(
    member: string,
    visited: Set<string>,
  ): Map<string, string | null> {
    const found = new Map<string, string | null>();
    const incoming = into.get(member) ?? [];

    for (const call of incoming) {
      if (call.how !== "dispatch") {
        found.set(moduleOf(call.from), null);
      }
    }

    for (const call of incoming) {
      if (call.how !== "dispatch" || visited.has(call.from)) {
        continue;
      }

      visited.add(call.from);

      for (const [module, through] of callersOf(call.from, visited)) {
        if (!found.has(module)) {
          found.set(module, through ?? classPart(call.from));
        }
      }
    }

    return found;
  }

  return {
    known: (module) => knownModules.has(module),
    of(module, qualified) {
      const member = `${module}::${qualified}`;
      const found = callersOf(member, new Set([member]));

      found.delete(module);

      return {
        callers: [...found]
          .map(([caller, through]) => ({ module: caller, through }))
          .sort(byLabel),
        constructed: (into.get(member) ?? []).some(
          (call) => call.how === "construct",
        ),
      };
    },
  };
}
