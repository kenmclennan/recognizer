import type { SensorFindings } from "@recognizer/core";
import { readSensorFindings } from "../adapters/filesystem/findings-translator.js";
import type { Io } from "../cli.js";
import { findingsFile } from "../findings-files.js";

export function readStoredStructure(
  io: Io,
  root: string,
): SensorFindings | null {
  try {
    return readSensorFindings(
      JSON.parse(io.readFile(findingsFile(root, "structure"))),
      { name: "structure" },
    );
  } catch {
    return null;
  }
}
