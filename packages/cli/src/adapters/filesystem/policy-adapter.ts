import {
  InvalidRequest,
  type PolicyRepository,
  type PolicyRule,
  type RepositoryText,
} from "@recognizer/core";
import { parse, stringify } from "yaml";
import type { Io } from "../../cli.js";
import { policyFile } from "../../config.js";
import { InputError } from "../../errors.js";
import { readPolicy } from "../../load-findings.js";
import { parsePolicy } from "./policy-translator.js";
import { readRepositoryText, saveRepositoryText } from "./repository-text.js";

export class PolicyAdapter implements PolicyRepository {
  constructor(private readonly io: Io) {}

  rules(root: string): readonly PolicyRule[] | null {
    return readPolicy(this.io, root);
  }

  rulesAt(path: string): readonly PolicyRule[] {
    let text: string;

    try {
      text = this.io.readFile(path);
    } catch {
      throw new InvalidRequest([`cannot read policy file: ${path}`]);
    }

    return parsePolicy(text);
  }

  defaultFile(root: string): string | null {
    const file = policyFile(root);

    return this.io.exists(file) ? file : null;
  }

  document(root: string): Record<string, unknown> {
    const file = policyFile(root);

    if (!this.io.exists(file)) {
      return {};
    }

    try {
      const text = this.io.readFile(file);

      if (text.trim() === "") {
        return {};
      }

      const value: unknown = parse(text);

      return typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  text(root: string): RepositoryText {
    return readRepositoryText(this.io, policyFile(root));
  }

  saveText(root: string, text: string): void {
    saveRepositoryText(this.io, policyFile(root), text);
  }

  problems(text: string): string[] {
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

  parseDocument(document: Record<string, unknown>): readonly PolicyRule[] {
    try {
      return parsePolicy(stringify(document));
    } catch (error) {
      throw error instanceof InputError
        ? new InvalidRequest(error.messages)
        : error;
    }
  }
}
