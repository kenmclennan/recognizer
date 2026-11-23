import type { Call } from "../dependency.js";
import type { Repository } from "../repository.js";
import { Neighbours } from "./neighbours.js";

export type Caller = { module: string; through: string | null };

export type CallerSummary = { callers: Caller[]; constructed: boolean };

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
    Neighbours.moduleLabel(a.module).localeCompare(
      Neighbours.moduleLabel(b.module),
    ) || a.module.localeCompare(b.module)
  );
}

export class CallerIndex {
  private constructor(
    private readonly into: Map<string, Call[]>,
    private readonly knownModules: Set<string>,
  ) {}

  static of(repository: Repository): CallerIndex {
    const into = new Map<string, Call[]>();
    const knownModules = new Set<string>();
    const languageOf = new Map(
      repository.files.map((file) => [file.path, file.language]),
    );
    const withCalls = new Set(
      repository.calls.map((call) => languageOf.get(moduleOf(call.from))),
    );

    for (const file of repository.files) {
      if (withCalls.has(file.language)) {
        knownModules.add(file.path);
      }
    }

    for (const call of repository.calls) {
      into.set(call.to, [...(into.get(call.to) ?? []), call]);
    }

    return new CallerIndex(into, knownModules);
  }

  known(module: string): boolean {
    return this.knownModules.has(module);
  }

  of(module: string, qualified: string): CallerSummary {
    const member = `${module}::${qualified}`;
    const found = this.callersOf(member, new Set([member]));

    found.delete(module);

    return {
      callers: [...found]
        .map(([caller, through]) => ({ module: caller, through }))
        .sort(byLabel),
      constructed: (this.into.get(member) ?? []).some(
        (call) => call.how === "construct",
      ),
    };
  }

  private callersOf(
    member: string,
    visited: Set<string>,
  ): Map<string, string | null> {
    const found = new Map<string, string | null>();
    const incoming = this.into.get(member) ?? [];

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

      for (const [module, through] of this.callersOf(call.from, visited)) {
        if (!found.has(module)) {
          found.set(module, through ?? classPart(call.from));
        }
      }
    }

    return found;
  }
}
