import type { RecordedScan, RecordedScans } from "@recognizer/core";
import { ScanCacheAdapter } from "./scan-cache-adapter.js";
import type { DocumentSelection } from "./scan-document-types.js";
import { selectionOf } from "./scan-translator.js";

const REQUIRED = [
  "extensions",
  "skip_directory_names",
  "skip_directory_prefixes",
  "skip_directory_suffixes",
  "skip_directories_containing",
  "skip_file_globs",
] as const;

function strings(value: unknown): boolean {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function recordedOf(text: string): RecordedScan | null {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }

  if (typeof value !== "object" || value === null) {
    return null;
  }

  const { files, selection } = value as {
    files?: unknown;
    selection?: Record<string, unknown>;
  };

  if (
    !Array.isArray(files) ||
    typeof selection !== "object" ||
    selection === null ||
    !REQUIRED.every((key) => strings(selection[key])) ||
    ["skip_paths", "input_file_globs", "input_absent_paths"].some(
      (key) => selection[key] !== undefined && !strings(selection[key]),
    )
  ) {
    return null;
  }

  const recorded: { path: string; hash: string }[] = [];

  for (const file of files) {
    const { path, hash } = (file ?? {}) as { path?: unknown; hash?: unknown };

    if (typeof path !== "string" || typeof hash !== "string") {
      return null;
    }

    recorded.push({ path, hash });
  }

  return {
    files: recorded,
    selection: selectionOf(selection as unknown as DocumentSelection),
  };
}

export class RecordedScansAdapter implements RecordedScans {
  constructor(private readonly cache = new ScanCacheAdapter()) {}

  read(root: string): readonly RecordedScan[] {
    return this.cache
      .read(root)
      .map(({ text }) => recordedOf(text))
      .filter((scan): scan is RecordedScan => scan !== null);
  }
}
