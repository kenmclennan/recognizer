import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureCacheIgnore } from "../cache-ignore.js";

let counter = 0;

export interface ScopeFiles {
  modules?: string;
  suites?: string;
  remove(): void;
}

export function writeScopeFiles(
  repository: string,
  kind: string,
  modules: string[] | undefined,
  suites: unknown | undefined,
): ScopeFiles {
  const directory = join(repository, ".recognizer", "cache");
  const files: string[] = [];
  const stage = (name: string, content: unknown): string => {
    counter += 1;

    const path = join(
      directory,
      `serve-${kind}-${name}-${process.pid}-${counter}.json`,
    );

    mkdirSync(directory, { recursive: true });
    ensureCacheIgnore(path);
    writeFileSync(path, JSON.stringify(content));
    files.push(path);

    return path;
  };
  const remove = () => {
    for (const path of files) {
      rmSync(path, { force: true });
    }
  };

  try {
    return {
      ...(modules === undefined ? {} : { modules: stage("modules", modules) }),
      ...(suites === undefined ? {} : { suites: stage("suites", suites) }),
      remove,
    };
  } catch (error) {
    remove();

    throw error;
  }
}
