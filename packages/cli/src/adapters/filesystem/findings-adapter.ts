import type { FindingsRepository, Measured } from "@recognizer/core";
import type { Io } from "../../cli.js";
import { findingsFile, findingsFolder } from "../../findings-files.js";
import { structureOverlayFile } from "../../structure-overlay.js";
import { readSensorFindings } from "./findings-translator.js";

export class FindingsAdapter implements FindingsRepository {
  constructor(private readonly io: Io) {}

  measuredOf(root: string, sensor: string): Measured | null {
    const file = findingsFile(root, sensor);

    if (!this.io.exists(file)) {
      return null;
    }

    try {
      const document = readSensorFindings(JSON.parse(this.io.readFile(file)), {
        name: sensor,
      });

      return {
        ...(document.inputs !== undefined ? { inputs: document.inputs } : {}),
        ...(document.tests !== undefined ? { tests: document.tests } : {}),
      };
    } catch {
      return {};
    }
  }

  testsDigest(root: string): string | null {
    let names: string[] = [];

    try {
      names = this.io.readDir(findingsFolder(root)).map(({ name }) => name);
    } catch {
      return null;
    }

    for (const name of names.filter((one) => one.endsWith(".json")).sort()) {
      const measured = this.measuredOf(root, name.replace(/\.json$/, ""));

      if (measured?.tests !== undefined) {
        return measured.tests;
      }
    }

    return null;
  }

  discardAnalysis(root: string, off: boolean): void {
    this.io.remove(findingsFile(root, "duplication"));

    if (off) {
      this.io.remove(findingsFile(root, "structure"));
      this.io.remove(structureOverlayFile(root));
    }
  }
}
