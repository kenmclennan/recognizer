import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import {
  type Identity,
  identityKey,
  parseBaseline,
  serialiseBaseline,
} from "./baseline.js";
import { type CheckResult, check } from "./check.js";
import { InputError } from "./errors.js";
import { parsePolicy } from "./policy.js";

export interface Io {
  exists(path: string): boolean;
  readFile(path: string): string;
  writeFile(path: string, content: string): void;
  stdout(text: string): void;
  stderr(text: string): void;
}

export function nodeIo(): Io {
  return {
    exists: (path) => existsSync(path),
    readFile: (path) => readFileSync(path, "utf8"),
    writeFile: (path, content) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    },
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  };
}

type BaselineAction = "none" | "initialised" | "shrunk";

function readInput(io: Io, path: string, what: string): string {
  try {
    return io.readFile(path);
  } catch {
    throw new InputError([`cannot read ${what} file: ${path}`]);
  }
}

function summary(result: CheckResult): string {
  const lines = result.new.map((violation) => {
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

  lines.push(
    `violations: ${result.violations.length}, new: ${result.new.length}, fixed: ${result.fixed.length}, unranked: ${result.unranked}`,
  );

  if (result.fixed.length > 0) {
    lines.push("run with --update-baseline to shrink the baseline");
  }

  return `${lines.join("\n")}\n`;
}

function execute(argv: string[], io: Io): number {
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
    },
  });

  if (positionals.length !== 1 || positionals[0] !== "check") {
    throw new InputError([
      "usage: recognizer check --scan <scan.json> --policy <policy.yaml>",
    ]);
  }

  if (!values.scan || !values.policy) {
    throw new InputError(["--scan and --policy are required"]);
  }

  if (values["update-baseline"] && values["init-baseline"]) {
    throw new InputError([
      "--update-baseline and --init-baseline cannot be used together",
    ]);
  }

  const baselinePath =
    values.baseline ??
    join(dirname(values.policy), "baselines", "violations.json");
  const present = io.exists(baselinePath);

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

  const policy = parsePolicy(readInput(io, values.policy, "policy"));
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

  io.stdout(
    `${JSON.stringify({ ...result, baseline: { path: baselinePath, present, action } }, null, 2)}\n`,
  );
  io.stderr(summary(result));

  return result.new.length > 0 ? 1 : 0;
}

export function run(argv: string[], io: Io = nodeIo()): number {
  try {
    return execute(argv, io);
  } catch (error) {
    if (error instanceof InputError) {
      io.stderr(`${error.messages.join("\n")}\n`);
    } else {
      io.stderr(`${(error as Error).message}\n`);
    }

    return 2;
  }
}
