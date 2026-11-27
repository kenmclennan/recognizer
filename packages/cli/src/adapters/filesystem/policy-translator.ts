import {
  type PolicyRule,
  policyNotYamlMessage,
  readPolicyDocument,
} from "@recognizer/core";
import { parse } from "yaml";
import { InputError } from "../../errors.js";

export function parsePolicy(yamlText: string): PolicyRule[] {
  let document: unknown;

  try {
    document = parse(yamlText);
  } catch (error) {
    throw new InputError([policyNotYamlMessage((error as Error).message)]);
  }

  const read = readPolicyDocument(document);

  if (!read.ok) {
    throw new InputError(read.messages);
  }

  return read.rules;
}
