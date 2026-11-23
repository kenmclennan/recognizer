import { identityKey } from "../../domain/history/baseline.js";
import type {
  BaselineEntry,
  BaselineRepository,
} from "../../domain/history/baseline-repository.js";
import type {
  BaselineAction,
  BaselineReport,
  Candidate,
  Ranked,
} from "../../domain/history/candidate.js";
import { InvalidRequest } from "../../domain/invalid-request.js";
import { rankByKeys } from "./rank-against-baseline.js";

export {
  identityKey,
  identityOfViolationId,
  violationId,
} from "../../domain/history/baseline.js";
export type {
  BaselineEntry,
  BaselineRepository,
  IdEntry,
  Identity,
} from "../../domain/history/baseline-repository.js";
export type {
  BaselineAction,
  BaselineReport,
  Candidate,
  GrownViolation,
  Ranked,
  ReportedViolation,
} from "../../domain/history/candidate.js";

export interface BaselineFlags {
  baseline: string | undefined;
  update: boolean;
  init: boolean;
}

export function rankCandidates(
  candidates: Candidate[],
  baseline: BaselineEntry[] | null,
): Ranked {
  const ranking = rankByKeys(candidates, baseline);

  return {
    violations: candidates.map((one) => one.value),
    new: ranking.new.map(({ candidate, fresh, grown }) => {
      const reported = candidate.value;

      if (reported.type === "other") {
        return reported;
      }

      const { violation } = reported.value;

      return {
        type: "violation",
        value: {
          violation: violation.narrowedTo((_, index) =>
            fresh.has(candidate.keys[index] as string),
          ),
          grown,
        },
      };
    }),
    fixed: ranking.fixed,
  };
}

export function settleBaseline(
  baselines: BaselineRepository,
  flags: BaselineFlags,
  baselinePath: string,
  candidates: Candidate[],
  hiddenKeys: Set<string> = new Set(),
): { result: Ranked; report: BaselineReport } {
  const present = baselines.exists(baselinePath);
  const baseline = present ? baselines.read(baselinePath) : null;

  if (flags.init && present) {
    throw new InvalidRequest([`baseline already exists: ${baselinePath}`]);
  }

  if (flags.update && !present) {
    throw new InvalidRequest([`baseline does not exist: ${baselinePath}`]);
  }

  let result = rankCandidates(candidates, baseline);

  result = {
    ...result,
    fixed: result.fixed.filter((entry) => !hiddenKeys.has(identityKey(entry))),
  };

  let action: BaselineAction = "none";

  if (flags.init) {
    const written = new Map<string, BaselineEntry>();

    for (const one of candidates) {
      for (const [index, entry] of one.entries.entries()) {
        written.set(one.keys[index] as string, entry);
      }
    }

    const entries = [...written.values()];

    baselines.write(baselinePath, entries);
    result = rankCandidates(candidates, entries);
    action = "initialised";
  } else if (
    flags.update &&
    result.new.length === 0 &&
    result.fixed.length > 0
  ) {
    const fixedKeys = new Set(result.fixed.map(identityKey));
    const kept = (baseline ?? []).filter(
      (entry) => !fixedKeys.has(identityKey(entry)),
    );

    baselines.write(baselinePath, kept);
    action = "shrunk";
  }

  return { result, report: { path: baselinePath, present, action } };
}
