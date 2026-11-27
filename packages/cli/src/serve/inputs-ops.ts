import { join } from "node:path";
import { identityKey, type PolicyRule } from "@recognizer/core";
import { parseBaseline } from "../adapters/filesystem/baseline-adapter.js";
import { parsePolicy } from "../adapters/filesystem/policy-translator.js";
import type { Io } from "../cli.js";
import { type Config, configFile, policyFile } from "../config.js";
import { parseConfig, registeredSensorNamesIn } from "../config-parse.js";
import { InputError } from "../errors.js";

export interface InputsAnswer {
  configText: string | null;
  config: Config | null;
  configProblem: string | null;
  registeredSensors: string[];
  policy: PolicyRule[] | null;
  policyProblem: string | null;
  baseline: string[] | null;
  baselineProblem: string | null;
  refused: string[];
}

function problemOf(error: unknown): string {
  return error instanceof InputError
    ? [...new Set(error.messages)].join("; ")
    : (error as Error).message;
}

function readInput(
  io: Io,
  path: string,
  label: string,
  refused: string[],
): string | null {
  if (!io.exists(path)) {
    return null;
  }

  try {
    return io.readFile(path);
  } catch (error) {
    refused.push(`${label}: ${(error as Error).message}`);

    return null;
  }
}

function parsed<T>(
  text: string | null,
  parse: (text: string) => T,
): { value: T | null; problem: string | null } {
  if (text === null) {
    return { value: null, problem: null };
  }

  try {
    return { value: parse(text), problem: null };
  } catch (error) {
    return { value: null, problem: problemOf(error) };
  }
}

export function readPolicy(io: Io, root: string): PolicyRule[] | null {
  const text = readInput(io, policyFile(root), ".recognizer/policy.yaml", []);

  return parsed(text, parsePolicy).value;
}

export function readInputs(io: Io, root: string): InputsAnswer {
  const refused: string[] = [];
  const configText = readInput(
    io,
    configFile(root),
    ".recognizer/config.yaml",
    refused,
  );
  const policyText = readInput(
    io,
    policyFile(root),
    ".recognizer/policy.yaml",
    refused,
  );
  const baselineText = readInput(
    io,
    join(root, ".recognizer", "baselines", "violations.json"),
    ".recognizer/baselines/violations.json",
    refused,
  );
  const config = parsed(configText, (text) => parseConfig(text));
  const policy = parsed(policyText, parsePolicy);
  const baseline = parsed(baselineText, (text) =>
    parseBaseline(text).map(identityKey),
  );

  return {
    configText,
    config: config.value,
    configProblem: config.problem,
    registeredSensors:
      configText === null ? [] : registeredSensorNamesIn(configText),
    policy: policy.value,
    policyProblem: policy.problem,
    baseline: baseline.value,
    baselineProblem: baseline.problem,
    refused,
  };
}
