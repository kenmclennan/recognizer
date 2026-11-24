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

export interface PluginRunView {
  name: string;
  state: PluginRunState;
  progress: Progress | null;
  stage: PluginStage | null;
  estimateMs: number | null;
}

export class PluginRun {
  private constructor(
    readonly name: string,
    readonly state: PluginRunState,
    readonly progress: Progress | null,
    readonly stage: PluginStage | null,
    readonly estimateMs: number | null,
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

  progressed(progress: Progress): PluginRun {
    if (this.state !== "running") {
      throw new InvalidEntity(
        "PluginRun",
        "only a running plugin run reports progress",
        `${this.name} is ${this.state}`,
      );
    }

    return new PluginRun(this.name, "running", progress, null, null);
  }

  end(state: PluginRunEnd): PluginRun {
    if (this.ended) {
      throw new InvalidEntity(
        "PluginRun",
        "a plugin run's end is set once",
        `${this.name} is already ${this.state}`,
      );
    }

    return new PluginRun(this.name, state, this.progress, null, null);
  }

  view(): PluginRunView {
    return {
      name: this.name,
      state: this.state,
      progress: this.progress,
      stage: this.stage,
      estimateMs: this.estimateMs,
    };
  }
}
