import { InvalidEntity } from "../invalid-entity.js";

export type FreshnessKind = "current" | "stale" | "never-run" | "checking";

export interface FreshnessView {
  state: FreshnessKind;
  outOfDate: string[];
}

export class ResultFreshness {
  private constructor(
    readonly state: FreshnessKind,
    readonly outOfDate: readonly string[],
  ) {
    if (state !== "stale" && outOfDate.length > 0) {
      throw new InvalidEntity(
        "ResultFreshness",
        "only a stale result lists out-of-date files",
        state,
      );
    }
  }

  static current(): ResultFreshness {
    return new ResultFreshness("current", []);
  }

  static stale(outOfDate: readonly string[]): ResultFreshness {
    return new ResultFreshness("stale", [...outOfDate].sort());
  }

  static neverRun(): ResultFreshness {
    return new ResultFreshness("never-run", []);
  }

  static checking(): ResultFreshness {
    return new ResultFreshness("checking", []);
  }

  static known(outOfDate: readonly string[]): ResultFreshness {
    return outOfDate.length === 0
      ? ResultFreshness.current()
      : ResultFreshness.stale(outOfDate);
  }

  view(): FreshnessView {
    return { state: this.state, outOfDate: [...this.outOfDate] };
  }
}
