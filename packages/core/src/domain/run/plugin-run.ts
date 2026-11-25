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

export interface PluginRunView {
  name: string;
  state: PluginRunState;
  progress: Progress | null;
  stage: PluginStage | null;
  estimateMs: number | null;
  failure: PluginFailure | null;
}

export class PluginRun {
  private constructor(
    readonly name: string,
    readonly state: PluginRunState,
    readonly progress: Progress | null,
    readonly stage: PluginStage | null,
    readonly estimateMs: number | null,
    readonly failure: PluginFailure | null = null,
  ) {}

  static queued(name: string): PluginRun {
    if (name === "") {
      throw new InvalidEntity("PluginRun", "a plugin run has a name", name);
    }

    return new PluginRun(name, "queued", null, null, null);
  }

  static of(
    name: string,
    state: PluginRunState,
    progress: Progress | null,
  ): PluginRun {
    if (state === "queued" && progress !== null) {
      throw new InvalidEntity(
        "PluginRun",
        "a queued plugin run has no progress",
        name,
      );
    }

    return new PluginRun(name, state, progress, null, null);
  }

  get ended(): boolean {
    return (
      this.state === "finished" ||
      this.state === "stopped" ||
      this.state === "failed"
    );
  }

  started(progress: Progress | null): PluginRun {
    if (this.state !== "queued") {
      throw new InvalidEntity(
        "PluginRun",
        "a plugin run starts once, from queued",
        `${this.name} is ${this.state}`,
      );
    }

    return new PluginRun(this.name, "running", progress, null, null);
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

    return new PluginRun(
      this.name,
      "running",
      this.progress,
      stage,
      this.estimateMs,
    );
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

    return new PluginRun(
      this.name,
      "running",
      this.progress,
      this.stage,
      estimateMs,
    );
  }

  progressed(progress: Progress): PluginRun {
    if (this.state !== "running") {
      throw new InvalidEntity(
        "PluginRun",
        "only a running plugin run reports progress",
        `${this.name} is ${this.state}`,
      );
    }

    return new PluginRun(
      this.name,
      "running",
      progress,
      this.stage,
      this.estimateMs,
    );
  }

  end(state: PluginRunEnd, failure?: PluginFailure): PluginRun {
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

    return new PluginRun(
      this.name,
      state,
      this.progress,
      this.stage,
      null,
      failure ?? null,
    );
  }

  view(): PluginRunView {
    return {
      name: this.name,
      state: this.state,
      progress: this.progress,
      stage: this.stage,
      estimateMs: this.estimateMs,
      failure: this.failure,
    };
  }
}
