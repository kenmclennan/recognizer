import type { Diagnosis } from "../diagnosis.js";
import { InvalidEntity } from "../invalid-entity.js";

export type PluginRunState =
  | "queued"
  | "running"
  | "finished"
  | "stopped"
  | "failed";

export type PluginRunEnd = "finished" | "stopped" | "failed";

export interface Progress {
  readonly done: number;
  readonly total: number;
  readonly unit: string;
}

export interface PluginStage {
  readonly name: string;
  readonly index: number;
  readonly of: number;
}

export interface PluginFailure {
  readonly reason: string;
  readonly diagnosis: Diagnosis | null;
}

export type PluginPhase = "extract" | "describe" | "sense";

export interface PluginTally {
  readonly ok: number;
  readonly failed: number;
  readonly firstFailure: { item: string; reason: string } | null;
}

export interface PluginRunView {
  name: string;
  phase: PluginPhase;
  state: PluginRunState;
  progress: Progress | null;
  stage: PluginStage | null;
  estimateMs: number | null;
  failure: PluginFailure | null;
  tally: PluginTally | null;
  durationMs: number | null;
}

export class PluginRun {
  private constructor(
    readonly name: string,
    readonly state: PluginRunState,
    readonly progress: Progress | null,
    readonly stage: PluginStage | null,
    readonly estimateMs: number | null,
    readonly failure: PluginFailure | null = null,
    readonly phase: PluginPhase = "sense",
    readonly tally: PluginTally | null = null,
    readonly startedAt: number | null = null,
    readonly endedAt: number | null = null,
  ) {}

  private next(changes: {
    state?: PluginRunState;
    progress?: Progress | null;
    stage?: PluginStage | null;
    estimateMs?: number | null;
    failure?: PluginFailure | null;
    tally?: PluginTally | null;
    startedAt?: number | null;
    endedAt?: number | null;
  }): PluginRun {
    return new PluginRun(
      this.name,
      changes.state ?? this.state,
      changes.progress === undefined ? this.progress : changes.progress,
      changes.stage === undefined ? this.stage : changes.stage,
      changes.estimateMs === undefined ? this.estimateMs : changes.estimateMs,
      changes.failure === undefined ? this.failure : changes.failure,
      this.phase,
      changes.tally === undefined ? this.tally : changes.tally,
      changes.startedAt === undefined ? this.startedAt : changes.startedAt,
      changes.endedAt === undefined ? this.endedAt : changes.endedAt,
    );
  }

  static queued(name: string, phase: PluginPhase = "sense"): PluginRun {
    if (name === "") {
      throw new InvalidEntity("PluginRun", "a plugin run has a name", name);
    }

    return new PluginRun(name, "queued", null, null, null, null, phase);
  }

  static of(
    name: string,
    state: PluginRunState,
    progress: Progress | null,
    phase: PluginPhase = "sense",
  ): PluginRun {
    if (state === "queued" && progress !== null) {
      throw new InvalidEntity(
        "PluginRun",
        "a queued plugin run has no progress",
        name,
      );
    }

    return new PluginRun(name, state, progress, null, null, null, phase);
  }

  get ended(): boolean {
    return (
      this.state === "finished" ||
      this.state === "stopped" ||
      this.state === "failed"
    );
  }

  started(progress: Progress | null, at: number | null = null): PluginRun {
    if (this.state !== "queued") {
      throw new InvalidEntity(
        "PluginRun",
        "a plugin run starts once, from queued",
        `${this.name} is ${this.state}`,
      );
    }

    return this.next({
      state: "running",
      progress,
      stage: null,
      estimateMs: null,
      startedAt: at,
    });
  }

  private running(what: string): void {
    if (this.state !== "running") {
      throw new InvalidEntity(
        "PluginRun",
        `only a running plugin run reports ${what}`,
        `${this.name} is ${this.state}`,
      );
    }
  }

  staged(stage: PluginStage): PluginRun {
    this.running("a stage");

    if (
      !Number.isInteger(stage.index) ||
      !Number.isInteger(stage.of) ||
      stage.index < 1 ||
      stage.index > stage.of
    ) {
      throw new InvalidEntity(
        "PluginRun",
        "a stage index runs from 1 up to its total",
        `${stage.index} of ${stage.of}`,
      );
    }

    return this.next({ stage });
  }

  estimated(estimateMs: number | null): PluginRun {
    this.running("an estimate");

    if (
      estimateMs !== null &&
      (!Number.isInteger(estimateMs) || estimateMs < 0)
    ) {
      throw new InvalidEntity(
        "PluginRun",
        "an estimate is a non-negative integer or none",
        estimateMs,
      );
    }

    return this.next({ estimateMs });
  }

  progressed(progress: Progress): PluginRun {
    if (this.state !== "running") {
      throw new InvalidEntity(
        "PluginRun",
        "only a running plugin run reports progress",
        `${this.name} is ${this.state}`,
      );
    }

    return this.next({ progress });
  }

  itemised(item: { item: string; ok: boolean; reason: string }): PluginRun {
    this.running("an item");

    const before = this.tally;
    const done = (this.progress?.done ?? 0) + 1;

    return this.next({
      progress: {
        done,
        total: this.progress?.total ?? done,
        unit: this.progress?.unit ?? "files",
      },
      tally: {
        ok: (before?.ok ?? 0) + (item.ok ? 1 : 0),
        failed: (before?.failed ?? 0) + (item.ok ? 0 : 1),
        firstFailure:
          before?.firstFailure ??
          (item.ok ? null : { item: item.item, reason: item.reason }),
      },
    });
  }

  get durationMs(): number | null {
    return this.startedAt === null || this.endedAt === null
      ? null
      : Math.max(0, this.endedAt - this.startedAt);
  }

  end(
    state: PluginRunEnd,
    failure?: PluginFailure,
    at: number | null = null,
  ): PluginRun {
    if (this.ended) {
      throw new InvalidEntity(
        "PluginRun",
        "a plugin run's end is set once",
        `${this.name} is already ${this.state}`,
      );
    }

    if (failure !== undefined && state !== "failed") {
      throw new InvalidEntity(
        "PluginRun",
        "only a failed plugin run carries a failure",
        `${this.name} ended ${state}`,
      );
    }

    if (state === "failed" && failure === undefined) {
      throw new InvalidEntity(
        "PluginRun",
        "a failed plugin run carries its failure",
        this.name,
      );
    }

    return this.next({
      state,
      estimateMs: null,
      failure: failure ?? null,
      endedAt: at,
    });
  }

  view(): PluginRunView {
    return {
      name: this.name,
      phase: this.phase,
      state: this.state,
      progress: this.progress,
      stage: this.stage,
      estimateMs: this.estimateMs,
      failure: this.failure,
      tally: this.tally,
      durationMs: this.durationMs,
    };
  }
}
