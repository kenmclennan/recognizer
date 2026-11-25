import { InvalidEntity } from "../invalid-entity.js";
import type { Run } from "./run.js";

export interface ResultAt {
  commit: string;
  modified: boolean;
}

export interface ReportedResult {
  findings: string | null;
  overlay: string | null;
  inputsDigest: string | null;
  testsDigest: string | null;
  reportedAt: string | null;
  inputs: Readonly<Record<string, string>> | null;
}

export interface PluginResult extends ReportedResult {
  unreadable: boolean;
}

export interface ResultEntry {
  at: ResultAt;
  result: PluginResult;
}

export interface ResultEntryView {
  commit: string;
  modified: boolean;
  findings: string | null;
  overlay: string | null;
  inputsDigest: string | null;
  testsDigest: string | null;
  reportedAt: string | null;
  unreadable: boolean;
}

export interface ResultsView {
  unreadable: number;
  results: ResultEntryView[];
}

function keyOf(at: ResultAt): string {
  return `${at.commit}\u0000${at.modified ? "modified" : "clean"}`;
}

function ordered(entries: readonly ResultEntry[]): ResultEntry[] {
  return [...entries].sort((a, b) => keyOf(a.at).localeCompare(keyOf(b.at)));
}

export class ResultSet {
  private constructor(
    private readonly byPlugin: ReadonlyMap<string, readonly ResultEntry[]>,
  ) {}

  static empty(): ResultSet {
    return new ResultSet(new Map());
  }

  static inputsDigestOf(inputs: Readonly<Record<string, string>>): string {
    const mask = (1n << 64n) - 1n;
    let hash = 0xcbf29ce484222325n;

    for (const path of Object.keys(inputs).sort()) {
      for (const char of `${path}=${inputs[path]}\n`) {
        hash =
          ((hash ^ BigInt(char.codePointAt(0) as number)) * 0x100000001b3n) &
          mask;
      }
    }

    return hash.toString(16).padStart(16, "0");
  }

  plugins(): string[] {
    return [...this.byPlugin.keys()].sort();
  }

  of(plugin: string): ResultEntry[] {
    return [...(this.byPlugin.get(plugin) ?? [])];
  }

  private with(plugin: string, entries: readonly ResultEntry[]): ResultSet {
    const next = new Map(this.byPlugin);

    next.set(plugin, ordered(entries));

    return new ResultSet(next);
  }

  reported(plugin: string, at: ResultAt, result: ReportedResult): ResultSet {
    const key = keyOf(at);
    const kept = this.of(plugin).filter((entry) => keyOf(entry.at) !== key);

    return this.with(plugin, [
      ...kept,
      { at, result: { ...result, unreadable: false } },
    ]);
  }

  without(plugin: string, at: ResultAt): ResultSet {
    const key = keyOf(at);

    return this.with(
      plugin,
      this.of(plugin).filter((entry) => keyOf(entry.at) !== key),
    );
  }

  flaggedUnreadable(plugin: string): ResultSet {
    const held = this.of(plugin);

    if (held.length === 0) {
      return this;
    }

    return this.with(
      plugin,
      held.map((entry) => ({
        at: entry.at,
        result: { ...entry.result, unreadable: true },
      })),
    );
  }

  replaced(
    plugin: string,
    run: Run,
    entries: readonly ResultEntry[],
  ): ResultSet {
    const state = run.plugin(plugin).state;

    if (state !== "finished") {
      throw new InvalidEntity(
        "ResultSet",
        "only a finished run replaces a plugin's results whole",
        `${plugin} is ${state}`,
      );
    }

    return this.with(plugin, entries);
  }

  within(names: readonly string[]): ResultSet {
    const next = new Map<string, readonly ResultEntry[]>();

    for (const name of names) {
      next.set(name, this.of(name));
    }

    return new ResultSet(next);
  }

  view(names: readonly string[]): Record<string, ResultsView> {
    return Object.fromEntries(
      names.map((name) => {
        const entries = this.of(name);

        return [
          name,
          {
            unreadable: entries.filter(({ result }) => result.unreadable)
              .length,
            results: entries.map(({ at, result }) => ({
              commit: at.commit,
              modified: at.modified,
              findings: result.findings,
              overlay: result.overlay,
              inputsDigest: result.inputsDigest,
              testsDigest: result.testsDigest,
              reportedAt: result.reportedAt,
              unreadable: result.unreadable,
            })),
          },
        ];
      }),
    );
  }
}
