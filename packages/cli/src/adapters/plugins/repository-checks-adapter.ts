import { join } from "node:path";
import {
  type CachedScansState,
  type ConfigDocumentRead,
  cachedScansState,
  type InstalledPlugin,
  type PolicyFacts,
  type PolicyParse,
  type PublishedValues,
  type RepositoryChecks,
} from "@recognizer/core";
import { parse } from "yaml";
import type { Io } from "../../cli.js";
import { configFile, readConfig } from "../../config.js";
import { registeredSensors, schemaMessages } from "../../config-parse.js";
import { detectLanguages } from "../../detect.js";
import { InputError } from "../../errors.js";
import { readCachedRepository } from "../../scan-facts.js";
import { languageRulesOf } from "../../scanners.js";
import { parsePolicy } from "../filesystem/policy-translator.js";
import { SourceFilesAdapter } from "../filesystem/source-files-adapter.js";
import { GitAdapter } from "../git/git-adapter.js";
import { KeyOwnersAdapter } from "./key-owners-adapter.js";

function topLevelKeys(text: string): string[] {
  let document: unknown;

  try {
    document = parse(text);
  } catch {
    return [];
  }

  return typeof document === "object" && document !== null
    ? Object.keys(document)
    : [];
}

function parsedPolicy(text: string): PolicyParse {
  try {
    return { ok: true, rules: parsePolicy(text) };
  } catch (error) {
    return {
      ok: false,
      messages:
        error instanceof InputError
          ? error.messages
          : [(error as Error).message],
    };
  }
}

function readIfPresent(io: Io, file: string): string | null {
  return io.exists(file) ? io.readFile(file) : null;
}

export class RepositoryChecksAdapter implements RepositoryChecks {
  constructor(private readonly io: Io) {}

  scansState(root: string, languages: readonly string[]): CachedScansState {
    const git = new GitAdapter(this.io);
    const files = new SourceFilesAdapter(this.io);

    return cachedScansState(
      {
        readCached: (language) => readCachedRepository(this.io, root, language),
        commit: () => git.commit(root),
        dirtyPaths: () => git.dirtyPaths(root),
        hashOf: (path) => files.hashOf(root, path),
      },
      languages,
    );
  }

  isDirectory(root: string): boolean {
    try {
      this.io.readDir(root);

      return true;
    } catch {
      return false;
    }
  }

  languages(root: string, scanners: readonly InstalledPlugin[]): string[] {
    return detectLanguages(this.io, root, languageRulesOf(scanners));
  }

  configDocument(root: string): ConfigDocumentRead {
    const text = readIfPresent(this.io, configFile(root));

    if (text === null) {
      return { kind: "absent" };
    }

    try {
      return { kind: "parsed", document: parse(text) ?? {} };
    } catch (error) {
      return { kind: "unparseable", message: (error as Error).message };
    }
  }

  configSchemaMessages(document: unknown): string[] {
    return schemaMessages(document);
  }

  publishedKeys(root: string): PublishedValues {
    return new KeyOwnersAdapter(this.io).schemas(root).schema.keys;
  }

  policyFacts(root: string): PolicyFacts {
    const text = readIfPresent(
      this.io,
      join(root, ".recognizer", "policy.yaml"),
    );

    if (text === null) {
      return { kind: "absent" };
    }

    return {
      kind: "read",
      keys: topLevelKeys(text),
      parsed: parsedPolicy(text),
    };
  }

  registeredSensors(
    root: string,
  ): { name: string; command: string[]; manifest?: string[] }[] {
    return registeredSensors(readConfig(this.io, root, ["sensors"]));
  }

  suites(root: string): readonly unknown[] | undefined {
    try {
      return readConfig(this.io, root, ["tests"])?.tests;
    } catch {
      return undefined;
    }
  }
}
