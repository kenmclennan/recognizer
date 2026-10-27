import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { type Analysis, analyse } from "./analyse.js";
import {
  type Identity,
  identityKey,
  parseBaseline,
  serialiseBaseline,
} from "./baseline.js";
import { type CheckResult, check } from "./check.js";
import type { Io } from "./cli.js";
import { InputError } from "./errors.js";
import { type Policy, parsePolicy } from "./policy.js";
import { validateScan } from "./scan.js";

const DEFAULT_HUB_THRESHOLD = 10;

type BaselineAction = "none" | "initialised" | "shrunk";

function readInput(io: Io, path: string, what: string): string {
  try {
    return io.readFile(path);
  } catch {
    throw new InputError([`cannot read ${what} file: ${path}`]);
  }
}

function summary(result: CheckResult | null, analysis: Analysis): string {
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

export function executeCheck(argv: string[], io: Io): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      scan: { type: "string" },
      policy: { type: "string" },
      baseline: { type: "string" },
      "update-baseline": { type: "boolean" },
      "init-baseline": { type: "boolean" },
      "hub-threshold": { type: "string" },
    },
  });

  if (positionals.length !== 0) {
    throw new InputError([
      "usage: recognizer check --scan <scan.json> [--policy <policy.yaml>]",
    ]);
  }

  if (!values.scan) {
    throw new InputError(["--scan is required"]);
  }

  const hubThreshold = parseThreshold(values["hub-threshold"]);

  if (
    !values.policy &&
    (values.baseline !== undefined ||
      values["update-baseline"] ||
      values["init-baseline"])
  ) {
    throw new InputError([
      "--baseline, --update-baseline and --init-baseline need --policy",
    ]);
  }

  if (values["update-baseline"] && values["init-baseline"]) {
    throw new InputError([
      "--update-baseline and --init-baseline cannot be used together",
    ]);
  }

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
  const present = io.exists(baselinePath);
  const baseline = present
    ? parseBaseline(readInput(io, baselinePath, "baseline"))
    : null;

  if (values["init-baseline"] && present) {
    throw new InputError([`baseline already exists: ${baselinePath}`]);
  }

  if (values["update-baseline"] && !present) {
    throw new InputError([`baseline does not exist: ${baselinePath}`]);
  }

  let result = check(scan, policy, baseline);
  let action: BaselineAction = "none";

  if (values["init-baseline"]) {
    const entries: Identity[] = result.violations;
    io.writeFile(baselinePath, serialiseBaseline(entries));
    result = check(scan, policy, entries);
    action = "initialised";
  } else if (
    values["update-baseline"] &&
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

  const analysis = analysePolicy(scan, policy, hubThreshold);

  io.stdout(
    `${JSON.stringify({ ...result, baseline: { path: baselinePath, present, action }, ...analysis }, null, 2)}\n`,
  );
  io.stderr(summary(result, analysis));

  return result.new.length > 0 ? 1 : 0;
}
