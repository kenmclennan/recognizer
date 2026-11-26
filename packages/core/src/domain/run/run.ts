import { InvalidEntity } from "../invalid-entity.js";
import type { RunFailure } from "../run-record.js";
import type { RunScope } from "../run-scope.js";
import {
  type PluginFailure,
  type PluginPhase,
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

export interface DescribeAsk {
  modules: number;
  model: string;
  inputTokens: number;
  costUsd: number | null;
}

export interface DescribeHalt {
  cause: "limit" | "failures";
  reason: string;
  described: number;
  notDescribed: number;
  threshold: number;
}

export interface RunConfirmation {
  ask: DescribeAsk;
  answer: "describe" | "skip" | null;
}

export interface RunStructure {
  state: "running" | "done" | "failed";
  files: number | null;
}

export type RunReport =
  | { kind: "running" }
  | {
      kind: "plugin-started";
      name: string;
      progress: Progress | null;
      phase?: PluginPhase;
    }
  | {
      kind: "plugin-progress";
      name: string;
      progress: Progress;
      phase?: PluginPhase;
    }
  | {
      kind: "plugin-stage";
      name: string;
      stage: PluginStage;
      phase?: PluginPhase;
    }
  | {
      kind: "plugin-estimate";
      name: string;
      estimateMs: number | null;
      phase?: PluginPhase;
    }
  | {
      kind: "plugin-item";
      name: string;
      item: string;
      ok: boolean;
      reason: string;
      phase?: PluginPhase;
    }
  | {
      kind: "plugin-ended";
      name: string;
      state: PluginRunEnd;
      failure?: PluginFailure;
      phase?: PluginPhase;
    }
  | {
      kind: "plugin-result";
      name: string;
      at: ResultAt;
      result: ReportedResult;
    }
  | { kind: "extract-planned"; languages: readonly string[] }
  | { kind: "extract-current" }
  | { kind: "confirmation-asked"; ask: DescribeAsk }
  | { kind: "confirmation-answered"; describe: boolean }
  | { kind: "describe-halted"; halt: DescribeHalt }
  | { kind: "structure"; state: RunStructure["state"]; files: number | null }
  | { kind: "logged"; log: string | null }
  | { kind: "ended"; end: RunEnd }
  | { kind: "unreadable" };

export interface RunChoices {
  sensors: readonly string[];
  describe: boolean;
  suites: Readonly<Record<string, readonly string[]>>;
}

export interface RunRemaining {
  ms: number | null;
  silent: string[];
}

export type PlannedEstimates = Readonly<Record<string, number>>;

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
  remaining: RunRemaining | null;
  confirmation: RunConfirmation | null;
  describeHalt: DescribeHalt | null;
  structure: RunStructure | null;
  log: string | null;
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
  extract?: "planned" | "current" | null;
  confirmation?: RunConfirmation | null;
  describeHalt?: DescribeHalt | null;
  structure?: RunStructure | null;
  log?: string | null;
  plannedMs?: PlannedEstimates;
}

const DESCRIBE_NAME = "describe";

const NO_REASON = "no reason was recorded";

const STARTS_RUNNING: ReadonlySet<RunReport["kind"]> = new Set([
  "plugin-started",
  "plugin-progress",
  "plugin-stage",
  "plugin-estimate",
  "plugin-item",
  "plugin-ended",
  "structure",
]);

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
  readonly extract: "planned" | "current" | null;
  readonly confirmation: RunConfirmation | null;
  readonly describeHalt: DescribeHalt | null;
  readonly structure: RunStructure | null;
  readonly log: string | null;
  readonly plannedMs: PlannedEstimates;

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
    this.extract = fields.extract ?? null;
    this.confirmation = fields.confirmation ?? null;
    this.describeHalt = fields.describeHalt ?? null;
    this.structure = fields.structure ?? null;
    this.log = fields.log ?? null;
    this.plannedMs = fields.plannedMs ?? {};
  }

  static begin(input: {
    id: string;
    startedBy: RunStarter;
    startedAt: string;
    scope: RunScope;
    choices: RunChoices;
    planned?: PlannedEstimates;
  }): Run {
    const { planned, ...rest } = input;

    return new Run({
      ...rest,
      ...(planned === undefined ? {} : { plannedMs: planned }),
      state: "checking",
      endedAt: null,
      exit: null,
      plugins: [
        ...(input.choices.describe
          ? [PluginRun.queued(DESCRIBE_NAME, "describe")]
          : []),
        ...input.choices.sensors.map((name) => PluginRun.queued(name)),
      ],
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

    const names = fields.plugins.map(({ phase, name }) => `${phase}:${name}`);

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
      extract: this.extract,
      confirmation: this.confirmation,
      describeHalt: this.describeHalt,
      structure: this.structure,
      log: this.log,
      plannedMs: this.plannedMs,
      ...changes,
    });
  }

  plugin(name: string, phase: PluginPhase = "sense"): PluginRun {
    const found = this.plugins.find(
      (one) => one.name === name && one.phase === phase,
    );

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
    return this.plugins.map((one) =>
      one.name === plugin.name && one.phase === plugin.phase ? plugin : one,
    );
  }

  private settleDescribe(
    plugins: readonly PluginRun[],
    atSummary: boolean,
    at: number | null,
  ): PluginRun[] {
    return plugins.map((one) => {
      if (one.phase !== "describe" || one.state !== "running") {
        return one;
      }

      const { progress, tally } = one;

      if (!atSummary && (progress === null || progress.done < progress.total)) {
        return one;
      }

      return tally !== null &&
        progress !== null &&
        tally.failed === progress.done &&
        progress.done > 0
        ? one.end(
            "failed",
            {
              reason: tally.firstFailure?.reason ?? NO_REASON,
              diagnosis: null,
            },
            at,
          )
        : one.end("finished", undefined, at);
    });
  }

  private skipping(name: string, phase: PluginPhase): Run {
    const at = this.plugins.findIndex(
      (one) => one.name === name && one.phase === phase,
    );

    if (at <= 0) {
      return this;
    }

    const plugins = this.plugins.map((one, index) =>
      index < at && one.state === "queued" && one.phase !== "sense"
        ? one.end("stopped")
        : one,
    );

    return plugins.some((one, index) => one !== this.plugins[index])
      ? this.with({ plugins })
      : this;
  }

  private counted(plugin: PluginRun, at: number | null): PluginRun[] {
    return this.settleDescribe(this.replacing(plugin), false, at);
  }

  private endedPlugin(
    report: Extract<RunReport, { kind: "plugin-ended" }>,
    at: number | null,
  ) {
    const phase = report.phase ?? "sense";
    const found = this.plugin(report.name, phase);
    const base =
      phase === "extract" && found.state === "queued"
        ? found.started(null, at)
        : found;

    return this.replacing(base.end(report.state, report.failure, at));
  }

  apply(report: RunReport, at: number | null = null): Run {
    if (this.state === "checking" && STARTS_RUNNING.has(report.kind)) {
      return this.with({ state: "running" }).apply(report, at);
    }

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
        return this.state === "running"
          ? this
          : this.with({ state: "running" });
      case "plugin-started": {
        const base = this.skipping(report.name, report.phase ?? "sense");

        return base.with({
          plugins: base.counted(
            base.plugin(report.name, report.phase).started(report.progress, at),
            at,
          ),
        });
      }
      case "plugin-progress":
        return this.with({
          plugins: this.counted(
            this.plugin(report.name, report.phase).progressed(report.progress),
            at,
          ),
        });
      case "plugin-stage":
        return this.with({
          plugins: this.replacing(
            this.plugin(report.name, report.phase).staged(report.stage),
          ),
        });
      case "plugin-estimate":
        return this.with({
          plugins: this.replacing(
            this.plugin(report.name, report.phase).estimated(report.estimateMs),
          ),
        });
      case "plugin-item":
        return this.with({
          plugins: this.counted(
            this.plugin(report.name, report.phase).itemised(report),
            at,
          ),
        });
      case "plugin-ended": {
        const base = this.skipping(report.name, report.phase ?? "sense");

        return base.with({ plugins: base.endedPlugin(report, at) });
      }
      case "plugin-result":
        this.plugin(report.name);

        return this;
      case "extract-planned":
        return this.planned(report.languages);
      case "extract-current":
        return this.planned(null);
      case "confirmation-asked":
        return this.asked(report.ask);
      case "confirmation-answered":
        return this.answered(report.describe);
      case "describe-halted":
        return this.halted(report.halt, at);
      case "structure":
        return this.with({
          structure: { state: report.state, files: report.files },
        });
      case "logged":
        return this.logged(report.log, at);
      case "ended":
        return this.ending(report.end, at);
    }
  }

  private planned(languages: readonly string[] | null): Run {
    if (
      this.extract !== null ||
      this.plugins.some(({ state }) => state !== "queued")
    ) {
      throw new InvalidEntity(
        "Run",
        "the extract plan is reported once, before any plugin starts",
        this.extract ?? "a plugin has started",
      );
    }

    return this.with({
      extract: languages === null ? "current" : "planned",
      plugins: [
        ...[...new Set(languages ?? [])].map((name) =>
          PluginRun.queued(name, "extract"),
        ),
        ...this.plugins,
      ],
    });
  }

  private asked(ask: DescribeAsk): Run {
    if (this.confirmation !== null && this.confirmation.answer === null) {
      throw new InvalidEntity(
        "Run",
        "a confirmation is asked once until it is answered",
        this.id,
      );
    }

    return this.with({ confirmation: { ask: { ...ask }, answer: null } });
  }

  private answered(describe: boolean): Run {
    if (this.confirmation === null || this.confirmation.answer !== null) {
      throw new InvalidEntity(
        "Run",
        "an answer needs an unanswered confirmation",
        this.id,
      );
    }

    return this.with({
      confirmation: {
        ask: this.confirmation.ask,
        answer: describe ? "describe" : "skip",
      },
      plugins: describe
        ? this.plugins
        : this.plugins.map((one) =>
            one.phase === "describe" && one.state === "queued"
              ? one.end("stopped")
              : one,
          ),
    });
  }

  private halted(halt: DescribeHalt, at: number | null): Run {
    if (this.describeHalt !== null) {
      throw new InvalidEntity(
        "Run",
        "the describe halt is reported once",
        this.id,
      );
    }

    return this.with({
      describeHalt: { ...halt },
      plugins: this.plugins.map((one) =>
        one.phase === "describe" && one.state === "running"
          ? one.end("stopped", undefined, at)
          : one,
      ),
    });
  }

  private logged(log: string | null, at: number | null): Run {
    const settled = this.settleDescribe(this.plugins, true, at);

    if (log === null || log === "" || this.log !== null) {
      return settled.some((one, at) => one !== this.plugins[at])
        ? this.with({ plugins: settled })
        : this;
    }

    return this.with({ log, plugins: settled });
  }

  private ending(end: RunEnd, at: number | null): Run {
    return this.with({
      confirmation:
        this.confirmation !== null && this.confirmation.answer === null
          ? null
          : this.confirmation,
      state: end.state,
      endedAt: end.endedAt,
      exit: end.exit,
      gaps: end.gaps ?? [],
      failure: end.failure ?? null,
      ran: end.ran ?? null,
      plugins: this.plugins.map((one) =>
        one.ended ? one : one.end("stopped", undefined, at),
      ),
    });
  }

  stopped(endedAt: string | null, at: number | null = null): Run {
    return this.apply(
      {
        kind: "ended",
        end: { state: "stopped", endedAt, exit: null },
      },
      at,
    );
  }

  running(): string[] {
    return this.plugins
      .filter(({ state, phase }) => state === "running" && phase === "sense")
      .map(({ name }) => name);
  }

  private remaining(): RunRemaining | null {
    if (this.startedBy !== "app" || this.state !== "running") {
      return null;
    }

    const live = this.plugins.filter(({ live }) => live);

    if (live.length === 0) {
      return null;
    }

    const effective = live.map((one) => ({
      name: one.name,
      estimate: one.effective(this.plannedMs[one.name]),
    }));
    const silent = effective
      .filter(({ estimate }) => estimate === null)
      .map(({ name }) => name);

    if (silent.length > 0) {
      return { ms: null, silent };
    }

    return {
      ms: effective.reduce((sum, { estimate }) => sum + (estimate?.ms ?? 0), 0),
      silent: [],
    };
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
      plugins: this.plugins.map((one) => one.view(this.plannedMs[one.name])),
      remaining: this.remaining(),
      confirmation:
        this.confirmation === null
          ? null
          : {
              ask: { ...this.confirmation.ask },
              answer: this.confirmation.answer,
            },
      describeHalt:
        this.describeHalt === null ? null : { ...this.describeHalt },
      structure: this.structure === null ? null : { ...this.structure },
      log: this.log,
    };
  }
}
