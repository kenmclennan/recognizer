import { InvalidEntity } from "../invalid-entity.js";
import type { RunFailure } from "../run-record.js";
import type { RunScope } from "../run-scope.js";
import {
  type PluginFailure,
  PluginRun,
  type PluginRunEnd,
  type PluginRunView,
  type PluginStage,
  type Progress,
} from "./plugin-run.js";
import type { ReportedResult, ResultAt } from "./result-set.js";

export type RunStarter = "cli" | "app";

export type RunState =
  | "checking"
  | "running"
  | "finished"
  | "failed"
  | "stopped"
  | "refused";

export type RunEndState = "finished" | "failed" | "stopped" | "refused";

export interface RunGap {
  id: string;
  line: string;
  needs: string[];
}

export interface RunEnd {
  state: RunEndState;
  endedAt: string | null;
  exit: number | null;
  gaps?: readonly RunGap[];
  failure?: RunFailure | null;
  ran?: readonly string[] | null;
}

export type RunReport =
  | { kind: "running" }
  | { kind: "plugin-started"; name: string; progress: Progress | null }
  | { kind: "plugin-progress"; name: string; progress: Progress }
  | { kind: "plugin-stage"; name: string; stage: PluginStage }
  | { kind: "plugin-estimate"; name: string; estimateMs: number | null }
  | {
      kind: "plugin-ended";
      name: string;
      state: PluginRunEnd;
      failure?: PluginFailure;
    }
  | {
      kind: "plugin-result";
      name: string;
      at: ResultAt;
      result: ReportedResult;
    }
  | { kind: "ended"; end: RunEnd }
  | { kind: "unreadable" };

export interface RunChoices {
  sensors: readonly string[];
  describe: boolean;
  suites: Readonly<Record<string, readonly string[]>>;
}

export interface RunView {
  id: string;
  startedBy: RunStarter;
  startedAt: string;
  scope: RunScope;
  sensors: string[];
  describe: boolean;
  suites: Record<string, string[]>;
  state: RunState;
  endedAt: string | null;
  exit: number | null;
  gaps: RunGap[];
  failure: RunFailure | null;
  ran: string[] | null;
  plugins: PluginRunView[];
}

export interface RunFields {
  id: string;
  startedBy: RunStarter;
  startedAt: string;
  scope: RunScope;
  choices: RunChoices;
  state: RunState;
  endedAt: string | null;
  exit: number | null;
  gaps?: readonly RunGap[];
  failure?: RunFailure | null;
  ran?: readonly string[] | null;
  plugins: readonly PluginRun[];
}

const ENDED: readonly RunState[] = ["finished", "failed", "stopped", "refused"];

export class Run {
  readonly id: string;
  readonly startedBy: RunStarter;
  readonly startedAt: string;
  readonly scope: RunScope;
  readonly choices: RunChoices;
  readonly state: RunState;
  readonly endedAt: string | null;
  readonly exit: number | null;
  readonly gaps: readonly RunGap[];
  readonly failure: RunFailure | null;
  readonly ran: readonly string[] | null;
  readonly plugins: readonly PluginRun[];

  constructor(fields: RunFields) {
    Run.check(fields);

    this.id = fields.id;
    this.startedBy = fields.startedBy;
    this.startedAt = fields.startedAt;
    this.scope = fields.scope;
    this.choices = fields.choices;
    this.state = fields.state;
    this.endedAt = fields.endedAt;
    this.exit = fields.exit;
    this.gaps = fields.gaps ?? [];
    this.failure = fields.failure ?? null;
    this.ran = fields.ran ?? null;
    this.plugins = [...fields.plugins];
  }

  static begin(input: {
    id: string;
    startedBy: RunStarter;
    startedAt: string;
    scope: RunScope;
    choices: RunChoices;
  }): Run {
    return new Run({
      ...input,
      state: "checking",
      endedAt: null,
      exit: null,
      plugins: input.choices.sensors.map((name) => PluginRun.queued(name)),
    });
  }

  private static check(fields: RunFields): void {
    if (fields.id === "") {
      throw new InvalidEntity("Run", "a run has an id", fields.id);
    }

    if (
      fields.scope.kind === "commit" &&
      (fields.scope.commit === "" || typeof fields.scope.commit !== "string")
    ) {
      throw new InvalidEntity(
        "Run",
        "a commit scope names a commit",
        fields.scope,
      );
    }

    const names = fields.plugins.map(({ name }) => name);

    if (new Set(names).size !== names.length) {
      throw new InvalidEntity(
        "Run",
        "a plugin appears once in a run",
        names.join(", "),
      );
    }

    fields.plugins.forEach((plugin, index) => {
      const before = fields.plugins[index - 1];

      if (before !== undefined && plugin.state !== "queued" && !before.ended) {
        throw new InvalidEntity(
          "Run",
          "a plugin runs only after the one before it ended",
          `${plugin.name} is ${plugin.state} while ${before.name} is ${before.state}`,
        );
      }
    });

    if (
      ENDED.includes(fields.state) &&
      fields.plugins.some(({ ended }) => !ended)
    ) {
      throw new InvalidEntity(
        "Run",
        "an ended run has no plugin run still waiting or running",
        fields.state,
      );
    }
  }

  get active(): boolean {
    return this.state === "checking" || this.state === "running";
  }

  private with(changes: Partial<RunFields>): Run {
    return new Run({
      id: this.id,
      startedBy: this.startedBy,
      startedAt: this.startedAt,
      scope: this.scope,
      choices: this.choices,
      state: this.state,
      endedAt: this.endedAt,
      exit: this.exit,
      gaps: this.gaps,
      failure: this.failure,
      ran: this.ran,
      plugins: this.plugins,
      ...changes,
    });
  }

  plugin(name: string): PluginRun {
    const found = this.plugins.find((one) => one.name === name);

    if (found === undefined) {
      throw new InvalidEntity(
        "Run",
        "a report names a plugin the run has",
        name,
      );
    }

    return found;
  }

  private replacing(plugin: PluginRun): PluginRun[] {
    return this.plugins.map((one) => (one.name === plugin.name ? plugin : one));
  }

  apply(report: RunReport): Run {
    if (!this.active) {
      throw new InvalidEntity(
        "Run",
        "an ended run refuses a report",
        `${this.id} is ${this.state}`,
      );
    }

    switch (report.kind) {
      case "unreadable":
        return this;
      case "running":
        if (this.state !== "checking") {
          throw new InvalidEntity(
            "Run",
            "a run only moves forward",
            `${this.id} is already ${this.state}`,
          );
        }

        return this.with({ state: "running" });
      case "plugin-started":
        return this.with({
          plugins: this.replacing(
            this.plugin(report.name).started(report.progress),
          ),
        });
      case "plugin-progress":
        return this.with({
          plugins: this.replacing(
            this.plugin(report.name).progressed(report.progress),
          ),
        });
      case "plugin-stage":
        return this.with({
          plugins: this.replacing(
            this.plugin(report.name).staged(report.stage),
          ),
        });
      case "plugin-estimate":
        return this.with({
          plugins: this.replacing(
            this.plugin(report.name).estimated(report.estimateMs),
          ),
        });
      case "plugin-ended":
        return this.with({
          plugins: this.replacing(
            this.plugin(report.name).end(report.state, report.failure),
          ),
        });
      case "plugin-result":
        this.plugin(report.name);

        return this;
      case "ended":
        return this.ending(report.end);
    }
  }

  private ending(end: RunEnd): Run {
    return this.with({
      state: end.state,
      endedAt: end.endedAt,
      exit: end.exit,
      gaps: end.gaps ?? [],
      failure: end.failure ?? null,
      ran: end.ran ?? null,
      plugins: this.plugins.map((one) =>
        one.ended ? one : one.end("stopped"),
      ),
    });
  }

  stopped(endedAt: string | null): Run {
    return this.apply({
      kind: "ended",
      end: { state: "stopped", endedAt, exit: null },
    });
  }

  running(): string[] {
    return this.plugins
      .filter(({ state }) => state === "running")
      .map(({ name }) => name);
  }

  view(): RunView {
    return {
      id: this.id,
      startedBy: this.startedBy,
      startedAt: this.startedAt,
      scope: this.scope,
      sensors: [...this.choices.sensors],
      describe: this.choices.describe,
      suites: Object.fromEntries(
        Object.entries(this.choices.suites).map(([name, suites]) => [
          name,
          [...suites],
        ]),
      ),
      state: this.state,
      endedAt: this.endedAt,
      exit: this.exit,
      gaps: this.gaps.map((gap) => ({ ...gap, needs: [...gap.needs] })),
      failure: this.failure === null ? null : { ...this.failure },
      ran: this.ran === null ? null : [...this.ran],
      plugins: this.plugins.map((one) => one.view()),
    };
  }
}
