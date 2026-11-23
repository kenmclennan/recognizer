import { join } from "node:path";
import {
  type FindingsRepository,
  type Measured,
  type ReportedFindings,
  type SensorFindings,
  type StoredFindings,
  type StructureOverlayInput,
  type UnitCache,
  type UnitCacheRead,
  unitCacheDocument,
  unitCacheOf,
} from "@recognizer/core";
import { type Io, packageVersion } from "../../cli.js";
import {
  findingsFile,
  findingsFolder,
  readStoredFindings,
  writeFindings,
} from "../../findings-files.js";
import {
  buildStructureOverlay,
  structureOverlayFile,
  writeStructureOverlay,
} from "../../structure-overlay.js";
import {
  readSensorFindings,
  sensorFindingsOfReport,
} from "./findings-translator.js";

export function unitCachePath(root: string): string {
  return join(root, ".recognizer", "cache", "duplication-units.json");
}

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

  readAll(root: string): StoredFindings[] {
    return readStoredFindings(this.io, root);
  }

  readStructure(root: string): SensorFindings | null {
    try {
      return readSensorFindings(
        JSON.parse(this.io.readFile(findingsFile(root, "structure"))),
        { name: "structure" },
      );
    } catch {
      return null;
    }
  }

  save(root: string, document: SensorFindings): void {
    writeFindings(this.io, root, document);
  }

  remove(root: string, sensor: string): void {
    this.io.remove(findingsFile(root, sensor));
  }

  readUnitCache(root: string): UnitCacheRead {
    const path = unitCachePath(root);

    if (!this.io.exists(path)) {
      return { cache: {}, problem: null };
    }

    try {
      return {
        cache: unitCacheOf(JSON.parse(this.io.readFile(path))),
        problem: null,
      };
    } catch (error) {
      return {
        cache: {},
        problem: `duplication: ignored the unreadable unit cache ${path}: ${(error as Error).message}\n`,
      };
    }
  }

  writeUnitCache(root: string, cache: UnitCache): string | null {
    const target = unitCachePath(root);
    const temp = `${target}.tmp`;

    try {
      this.io.writeFile(temp, `${JSON.stringify(unitCacheDocument(cache))}\n`);
      this.io.rename(temp, target);

      return null;
    } catch (error) {
      this.io.remove(temp);

      return `duplication: could not write the unit cache: ${(error as Error).message}\n`;
    }
  }

  saveStructureOverlay(root: string, input: StructureOverlayInput): void {
    writeStructureOverlay(
      this.io,
      root,
      buildStructureOverlay({ ...input, version: packageVersion() }),
    );
  }

  documentOfReport(report: ReportedFindings): SensorFindings {
    return sensorFindingsOfReport(report);
  }
}
