import { join } from "node:path";
import type {
  LineKind,
  ResponsibilityKinds,
  StructureRepository,
} from "@recognizer/core";
import { Repository } from "@recognizer/core";
import type { Io } from "../../cli.js";
import { readConfig } from "../../config.js";
import { findDescriber } from "../../describer-in-effect.js";
import type { Language } from "../../detect.js";
import {
  lineStatus,
  type ResponsibilityEntry,
  validateResponsibilities,
} from "../../responsibilities.js";
import { CACHE, cacheFile, readCachedRepository } from "../../scan-facts.js";
import { scanFileText } from "./scan-translator.js";

export class StructureAdapter implements StructureRepository {
  constructor(private readonly io: Io) {}

  exists(root: string): boolean {
    try {
      this.io.readDir(root);

      return true;
    } catch {
      return false;
    }
  }

  save(root: string, language: string, scanned: Repository): void {
    const [only] = scanned.extractions;

    if (scanned.extractions.length !== 1 || only?.language !== language) {
      throw new Error(
        `cannot save ${language}: the repository holds ${scanned.extractions.map((one) => one.language).join(", ") || "no extraction"}`,
      );
    }

    this.io.writeFile(
      cacheFile(root, language as Language),
      scanFileText(scanned),
    );
  }

  discard(root: string, language: string): boolean {
    const path = cacheFile(root, language as Language);

    if (!this.io.exists(path)) {
      return false;
    }

    this.io.remove(path);

    return true;
  }

  read(root: string): Repository {
    let names: string[] = [];

    try {
      names = this.io.readDir(join(root, CACHE)).map(({ name }) => name);
    } catch {
      return Repository.empty;
    }

    return Repository.join(
      names
        .map((name) => /^scan\.(.+)\.json$/.exec(name)?.[1])
        .filter((language): language is string => language !== undefined)
        .sort()
        .flatMap((language) => {
          const cached = readCachedRepository(
            this.io,
            root,
            language as Language,
          );

          return cached === null ? [] : [cached];
        }),
    );
  }

  responsibilityKinds(root: string): ResponsibilityKinds {
    const configured = readConfig(this.io, root, ["describer"])?.describer;

    if (configured === undefined) {
      return { registered: false, kinds: {} };
    }

    const repository = this.read(root);
    const modules = repository.files.map(({ path }) => path);
    const file = join(root, ".recognizer", "responsibilities.json");
    const kinds: Record<string, LineKind> = {};

    let entries: Record<string, ResponsibilityEntry> = {};

    if (this.io.exists(file)) {
      try {
        entries = validateResponsibilities(
          JSON.parse(this.io.readFile(file)),
        ).modules;
      } catch {
        for (const id of modules) {
          kinds[id] = "unknown";
        }

        return { registered: true, kinds };
      }
    }

    const describer = findDescriber(this.io, root);
    const hashes = repository.scannedHashes();

    for (const id of modules) {
      const entry = entries[id];

      if (entry === undefined) {
        kinds[id] = "missing";
      } else if (describer === null || !hashes.has(id)) {
        kinds[id] = "out-of-date";
      } else {
        kinds[id] =
          lineStatus(
            entry,
            hashes.get(id) as string,
            describer.command,
            describer.version,
          ).status === "current"
            ? "current"
            : "out-of-date";
      }
    }

    return { registered: true, kinds };
  }
}
