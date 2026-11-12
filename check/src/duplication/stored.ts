import type { Io } from "../cli.js";
import {
  type FindingsDocument,
  validateFindings,
} from "../findings-document.js";
import { findingsFile } from "../findings-files.js";

export function readStoredStructure(
  io: Io,
  root: string,
): FindingsDocument | null {
  try {
    return validateFindings(
      JSON.parse(io.readFile(findingsFile(root, "structure"))),
      { name: "structure" },
    );
  } catch {
    return null;
  }
}
