import { join } from "node:path";
import type { StructureRepository } from "@recognizer/core";
import { Repository } from "@recognizer/core";
import type { Io } from "../../cli.js";
import type { Language } from "../../detect.js";
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
}
