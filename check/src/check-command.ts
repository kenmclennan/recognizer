import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { type Analysis, analyse } from "./analyse.js";
import {
  type Identity,
  identityKey,
  parseBaseline,
  serialiseBaseline,
} from "./baseline.js";
import { type CheckResult, check, rankAgainstBaseline } from "./check.js";
import type { Io } from "./cli.js";
import { InputError } from "./errors.js";
import { freshScans } from "./freshness.js";
import { moduleNames } from "./neighbours.js";
import { type Policy, parsePolicy } from "./policy.js";
import { collectViolations, type Violation } from "./rules.js";
import { type Scan, validateScan } from "./scan.js";

const DEFAULT_HUB_THRESHOLD = 10;

type BaselineAction = "none" | "initialised" | "shrunk";

function readInput(io: Io, path: string, what: string): string {
  try {
    return io.readFile(path);
  } catch {
    throw new InputError([`cannot read ${what} file: ${path}`]);
  }
}

function summary(
  result: CheckResult | null,
  analysis: Analysis,
  listWarnings = false,
): string {
  const lines = (result?.new ?? []).map((violation) => {
    const rules = violation.rules
      .map((rule) => {
        if (rule.type === "level") {
          return `level ${rule.from_level} -> ${rule.to_level}`;
        }

        if (rule.type === "uses") {
          return `uses ${rule.from_component} -> ${rule.to_component}`;
        }

        return `forbid ${rule.pattern}`;
      })
      .join("; ");

    return `${violation.from} -> ${violation.to} (${violation.kind}) line ${violation.lines.join(", ")}: ${rules}`;
  });

  if (result) {
    lines.push(
      `violations: ${result.violations.length}, new: ${result.new.length}, fixed: ${result.fixed.length}, unranked: ${result.unranked}`,
    );

    if (result.fixed.length > 0) {
      lines.push("run with --update-baseline to shrink the baseline");
    }
  }

  lines.push(`warnings: ${analysis.warnings.length}`);

  if (listWarnings) {
    lines.push(
      ...analysis.warnings.map((warning) => `warning: ${warning.summary}`),
    );
  }

  return `${lines.join("\n")}\n`;
}

function parseThreshold(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_HUB_THRESHOLD;
  }

  if (!/^\d+$/.test(raw) || Number(raw) < 1) {
    throw new InputError([`--hub-threshold must be an integer >= 1: ${raw}`]);
  }

  return Number(raw);
}

function analysePolicy(scan: unknown, policy: Policy, hub: number): Analysis {
  return analyse(validateScan(scan), { hub }, policy.ignore);
}

const OPTIONS = {
  scan: { type: "string" },
  repository: { type: "string" },
  json: { type: "boolean" },
  policy: { type: "string" },
  baseline: { type: "string" },
  "update-baseline": { type: "boolean" },
  "init-baseline": { type: "boolean" },
  "hub-threshold": { type: "string" },
} as const;

interface BaselineFlags {
  baseline: string | undefined;
  update: boolean;
  init: boolean;
}

function settleBaseline(
  io: Io,
  flags: BaselineFlags,
  baselinePath: string,
  rank: (baseline: Identity[] | null) => CheckResult,
): {
  result: CheckResult;
  report: { path: string; present: boolean; action: BaselineAction };
} {
  const present = io.exists(baselinePath);
  const baseline = present
    ? parseBaseline(readInput(io, baselinePath, "baseline"))
    : null;

  if (flags.init && present) {
    throw new InputError([`baseline already exists: ${baselinePath}`]);
  }

  if (flags.update && !present) {
    throw new InputError([`baseline does not exist: ${baselinePath}`]);
  }

  let result = rank(baseline);
  let action: BaselineAction = "none";

  if (flags.init) {
    const entries: Identity[] = result.violations;
    io.writeFile(baselinePath, serialiseBaseline(entries));
    result = rank(entries);
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
    io.writeFile(baselinePath, serialiseBaseline(kept));
    action = "shrunk";
  }

  return { result, report: { path: baselinePath, present, action } };
}

function rejectBaselineFlagsWithoutPolicy(
  flags: BaselineFlags,
  policyGiven: boolean,
): void {
  if (
    !policyGiven &&
    (flags.baseline !== undefined || flags.update || flags.init)
  ) {
    throw new InputError([
      "--baseline, --update-baseline and --init-baseline need --policy",
    ]);
  }

  if (flags.update && flags.init) {
    throw new InputError([
      "--update-baseline and --init-baseline cannot be used together",
    ]);
  }
}

function executeScanReplay(
  values: {
    scan: string;
    policy?: string;
    baseline?: string;
    "update-baseline"?: boolean;
    "init-baseline"?: boolean;
    "hub-threshold"?: string;
  },
  io: Io,
): number {
  const hubThreshold = parseThreshold(values["hub-threshold"]);
  const flags: BaselineFlags = {
    baseline: values.baseline,
    update: values["update-baseline"] === true,
    init: values["init-baseline"] === true,
  };

  rejectBaselineFlagsWithoutPolicy(flags, Boolean(values.policy));

  let scan: unknown;

  try {
    scan = JSON.parse(readInput(io, values.scan, "scan"));
  } catch (error) {
    if (error instanceof InputError) {
      throw error;
    }

    throw new InputError([
      `scan is not valid JSON: ${(error as Error).message}`,
    ]);
  }

  if (!values.policy) {
    const analysis = analyse(validateScan(scan), { hub: hubThreshold });

    io.stdout(`${JSON.stringify(analysis, null, 2)}\n`);
    io.stderr(summary(null, analysis));

    return 0;
  }

  const policy = parsePolicy(readInput(io, values.policy, "policy"));
  const baselinePath =
    values.baseline ??
    join(dirname(values.policy), "baselines", "violations.json");
  const { result, report } = settleBaseline(
    io,
    flags,
    baselinePath,
    (baseline) => check(scan, policy, baseline),
  );
  const analysis = analysePolicy(scan, policy, hubThreshold);

  io.stdout(
    `${JSON.stringify({ ...result, baseline: report, ...analysis }, null, 2)}\n`,
  );
  io.stderr(summary(result, analysis));

  return result.new.length > 0 ? 1 : 0;
}

function touches(modules: Set<string>, violation: Identity): boolean {
  return modules.has(violation.from) || modules.has(violation.to);
}

function mergedAnalysis(
  scans: Scan[],
  hub: number,
  policy: Policy | null,
): Analysis {
  const analyses = scans.map((scan) => analyse(scan, { hub }, policy?.ignore));

  return {
    thresholds: { hub },
    warnings: analyses.flatMap((analysis) => analysis.warnings),
    metrics: analyses.flatMap((analysis) => analysis.metrics),
  };
}

function narrowAnalysis(analysis: Analysis, modules: Set<string>): Analysis {
  return {
    thresholds: analysis.thresholds,
    warnings: analysis.warnings.filter((warning) =>
      (warning.id === "cycle"
        ? warning.evidence.modules
        : [warning.evidence.module]
      ).some((id) => modules.has(id)),
    ),
    metrics: analysis.metrics.filter((metric) => modules.has(metric.id)),
  };
}

function defaultPolicyFile(io: Io, root: string): string | null {
  const file = join(root, ".recognizer", "policy.yaml");

  return io.exists(file) ? file : null;
}

function executeRepository(
  values: {
    repository?: string;
    json?: boolean;
    policy?: string;
    baseline?: string;
    "update-baseline"?: boolean;
    "init-baseline"?: boolean;
    "hub-threshold"?: string;
  },
  named: string[],
  io: Io,
): number {
  const hubThreshold = parseThreshold(values["hub-threshold"]);
  const root = resolve(values.repository ?? ".");
  const policyFile = values.policy ?? defaultPolicyFile(io, root);
  const flags: BaselineFlags = {
    baseline: values.baseline,
    update: values["update-baseline"] === true,
    init: values["init-baseline"] === true,
  };

  rejectBaselineFlagsWithoutPolicy(flags, policyFile !== null);

  if (named.length > 0 && (flags.update || flags.init)) {
    throw new InputError([
      "--update-baseline and --init-baseline check the whole repository and take no module",
    ]);
  }

  const { scans } = freshScans(io, root);
  const known = new Set(moduleNames(scans));
  const unknown = named.filter((id) => !known.has(id));

  if (unknown.length > 0) {
    throw new InputError(unknown.map((id) => `no such module: ${id}`));
  }

  const listed = new Set(named);
  const narrowed = named.length > 0;
  const policy =
    policyFile === null
      ? null
      : parsePolicy(readInput(io, policyFile, "policy"));
  const full = mergedAnalysis(scans, hubThreshold, policy);
  const analysis = narrowed ? narrowAnalysis(full, listed) : full;

  if (policy === null || policyFile === null) {
    io.stdout(
      values.json
        ? `${JSON.stringify(analysis, null, 2)}\n`
        : summary(null, analysis, true),
    );

    return 0;
  }

  const collected = scans.map((scan) => collectViolations(scan, policy));
  const violations: Violation[] = collected.flatMap((one) => one.violations);
  const unranked = collected.reduce((sum, one) => sum + one.unranked, 0);
  const baselinePath =
    values.baseline ??
    join(dirname(policyFile), "baselines", "violations.json");
  const settled = settleBaseline(io, flags, baselinePath, (baseline) =>
    rankAgainstBaseline(violations, unranked, baseline),
  );
  const result: CheckResult = narrowed
    ? {
        violations: settled.result.violations.filter((one) =>
          touches(listed, one),
        ),
        new: settled.result.new.filter((one) => touches(listed, one)),
        fixed: settled.result.fixed.filter((one) => touches(listed, one)),
        unranked: settled.result.unranked,
      }
    : settled.result;

  io.stdout(
    values.json
      ? `${JSON.stringify({ ...result, baseline: settled.report, ...analysis }, null, 2)}\n`
      : summary(result, analysis, true),
  );

  return result.new.length > 0 ? 1 : 0;
}

export function executeCheck(argv: string[], io: Io): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: OPTIONS,
  });

  if (values.scan === undefined) {
    return executeRepository(values, positionals, io);
  }

  if (
    positionals.length !== 0 ||
    values.json !== undefined ||
    values.repository !== undefined
  ) {
    throw new InputError([
      "usage: recognizer check --scan <scan.json> [--policy <policy.yaml>]",
    ]);
  }

  return executeScanReplay({ ...values, scan: values.scan }, io);
}
