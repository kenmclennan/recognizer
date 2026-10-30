import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Io } from "./cli.js";
import type { RecordedScan, Scan } from "./scan.js";

export interface ModuleSource {
  files: string[];
  source: string;
  hash: string;
}

function parentOf(path: string): string {
  const cut = path.lastIndexOf("/");

  return cut === -1 ? "" : path.slice(0, cut);
}

function sourceFiles(scans: Scan[], id: string): string[] {
  const listing = scans.find((scan) =>
    scan.modules.some((module) => module.id === id),
  ) as RecordedScan | undefined;
  const paths = (listing?.files ?? []).map((file) => file.path);

  if (paths.includes(id)) {
    return [id];
  }

  return paths.filter((path) => parentOf(path) === id).sort();
}

export function moduleSource(
  io: Io,
  root: string,
  scans: Scan[],
  id: string,
): ModuleSource | null {
  const files = sourceFiles(scans, id);

  if (files.length === 0) {
    return null;
  }

  try {
    const texts = files.map((file) => io.readFile(join(root, file)));
    const source =
      files.length === 1
        ? (texts[0] as string)
        : files
            .map((file, index) => {
              const text = texts[index] as string;

              return `==> ${file} <==\n${text}${text.endsWith("\n") ? "" : "\n"}`;
            })
            .join("");
    const hash = createHash("sha256").update(source, "utf8").digest("hex");

    return { files, source, hash };
  } catch {
    return null;
  }
}
