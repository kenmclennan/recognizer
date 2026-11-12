import type { Io } from "./cli.js";
import { policyFile } from "./config.js";
import { publish } from "./config-keys.js";
import { InputError } from "./errors.js";
import {
  type KeyedCommand,
  keysHelp,
  runKeyed,
  usageFor,
} from "./key-command.js";
import { parsePolicy } from "./policy.js";
import { POLICY_KEYS } from "./policy-keys.js";

const PUBLISHED = publish([POLICY_KEYS], "policy");

function errorsOf(text: string): string[] {
  if (text.trim() === "") {
    return [];
  }

  try {
    parsePolicy(text);

    return [];
  } catch (error) {
    if (error instanceof InputError) {
      return error.messages;
    }

    throw error;
  }
}

function introduced(original: string, text: string): string | null {
  const before = new Set(errorsOf(original));
  const added = errorsOf(text).filter((message) => !before.has(message));

  return added.length === 0 ? null : added.join("; ");
}

const POLICY: KeyedCommand = {
  noun: "policy",
  usage: usageFor("policy"),
  fileFor: policyFile,
  keysFor: () => PUBLISHED,
  validate: introduced,
  missing: "there is no policy at .recognizer/policy.yaml",
};

export function runPolicy(argv: string[], io: Io): number {
  return runKeyed(POLICY, argv, io);
}

export function policyKeysHelp(): string {
  return keysHelp(POLICY, PUBLISHED);
}
