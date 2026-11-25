import { join } from "node:path";
import type { Io } from "../cli.js";

let counter = 0;

export interface ScopeFiles {
  modules?: string;
  suites?: string;
  remove(): void;
}

export function writeScopeFiles(
  io: Io,
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

    io.writeFile(path, JSON.stringify(content));
    files.push(path);

    return path;
  };
  const remove = () => {
    for (const path of files) {
      io.remove(path);
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
