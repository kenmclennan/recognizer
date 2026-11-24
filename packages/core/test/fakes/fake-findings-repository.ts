import type {
  FindingsRepository,
  Measured,
  ReportedFindings,
  SensorFindings,
  StoredFindings,
  StructureOverlayInput,
  UnitCache,
  UnitCacheRead,
} from "../../src/index.js";

export class FakeFindingsRepository implements FindingsRepository {
  readonly measured = new Map<string, Measured>();
  readonly stored = new Map<string, StoredFindings>();
  readonly overlays: StructureOverlayInput[] = [];
  readonly saved: SensorFindings[] = [];
  readonly removed: string[] = [];
  unitCache: UnitCache = {};

  invalidate(name: string, reason = "the document is not valid"): void {
    this.stored.set(name, { name, status: "invalid", reason });
  }

  measuredOf(root: string, sensor: string): Measured | null {
    return this.measured.get(`${root}::${sensor}`) ?? null;
  }

  discardAnalysis(): void {}

  readAll(): StoredFindings[] {
    return [...this.stored.values()].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
  }

  readStructure(): SensorFindings | null {
    const held = this.stored.get("structure");

    return held?.status === "read" ? held.document : null;
  }

  save(_root: string, document: SensorFindings): void {
    this.saved.push(document);
    this.stored.set(document.sensor.name, {
      name: document.sensor.name,
      status: "read",
      document,
    });
  }

  remove(_root: string, sensor: string): void {
    this.removed.push(sensor);
    this.stored.delete(sensor);
  }

  readUnitCache(): UnitCacheRead {
    return { cache: this.unitCache, problem: null };
  }

  writeUnitCache(_root: string, cache: UnitCache): string | null {
    this.unitCache = cache;

    return null;
  }

  saveStructureOverlay(_root: string, input: StructureOverlayInput): void {
    this.overlays.push(input);
  }

  documentOfReport(report: ReportedFindings): SensorFindings {
    return {
      sensor: { name: report.name, version: report.version },
      commit: report.commit,
      modified: report.modified,
      settings: {},
      reportedAt: report.reportedAt,
      findings: [],
      inputs: report.inputs,
    };
  }
}
