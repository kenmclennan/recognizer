import type { Repository, ScanFileText } from "@recognizer/core";
import { readRepository } from "./adapters/filesystem/scan-translator.js";
import { judgeScanVersion, SCAN_SCHEMA_VERSION } from "./scan.js";

export interface StructureScan {
  file: string;
  document: unknown;
}

export interface StructureRead {
  scans: StructureScan[];
  notices: string[];
}

function isList(value: unknown): boolean {
  return Array.isArray(value);
}

function refusal(file: string, text: string): StructureScan | string {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return `${file} is not valid JSON: ${(error as Error).message}`;
  }

  const document = parsed as Record<string, unknown> | null;
  const version = document?.schema_version;

  if (typeof document !== "object" || document === null) {
    return `${file} is not a scan document`;
  }

  const refused =
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    ["newer", "broken"].includes(judgeScanVersion(version));

  if (refused) {
    return `${file} has schema_version ${String(version)}; this viewer reads ${SCAN_SCHEMA_VERSION}`;
  }

  if (
    !isList(document.modules) ||
    !isList(document.edges) ||
    !isList(document.foreign)
  ) {
    return `${file} is not a scan: it lacks the files, edges and foreign lists`;
  }

  try {
    readRepository([
      {
        language:
          /^scan\.(.+)\.json$/.exec(file.split("/").pop() ?? "")?.[1] ??
          "unknown",
        document,
      },
    ]);

    return { file, document };
  } catch (error) {
    return `${file} is not a valid scan: ${(error as Error).message}`;
  }
}

export function readStructure(files: readonly ScanFileText[]): StructureRead {
  const read: StructureRead = { scans: [], notices: [] };

  for (const { file, text } of files) {
    const outcome = refusal(file, text);

    if (typeof outcome === "string") {
      read.notices.push(outcome);
    } else {
      read.scans.push(outcome);
    }
  }

  return read;
}

type Historical =
  | { ok: false; reason: string }
  | ({ ok: true } & Record<string, unknown>);

function typedScans(files: readonly ScanFileText[]): StructureScan[] | string {
  const read = readStructure(files);

  return read.notices[0] ?? read.scans;
}

export function typedHistorical(reply: Historical): Historical {
  if (!reply.ok) {
    return reply;
  }

  const typed: Record<string, unknown> = { ...reply };

  for (const key of ["scans", "baseScans", "headScans"]) {
    if (key in reply) {
      const scans = typedScans(reply[key] as ScanFileText[]);

      if (typeof scans === "string") {
        return { ok: false, reason: scans };
      }

      typed[key] = scans;
    }
  }

  return typed as Historical;
}

export function repositoryOfScans(
  files: readonly ScanFileText[],
): Repository | null {
  const read = readStructure(files);

  if (read.scans.length === 0) {
    return null;
  }

  return readRepository(
    read.scans.map(({ file, document }) => ({
      language: /^scan\.(.+)\.json$/.exec(file)?.[1] ?? "unknown",
      document,
    })),
  );
}
