import type {
  AccumulatedOverlay,
  CommitResults,
  FindingsRepository,
  Measured,
  ReportedFindings,
  RunScope,
  SensorFindings,
  SettleEnding,
  StoredFindings,
  StoredOverlay,
  StructureOverlayInput,
  UnitCache,
  UnitCacheRead,
} from "../../src/index.js";

export class FakeFindingsRepository implements FindingsRepository {
  readonly measured = new Map<string, Measured>();
  readonly stored = new Map<string, StoredFindings>();
  readonly storedOverlays = new Map<string, StoredOverlay>();
  readonly overlays: StructureOverlayInput[] = [];
  readonly saved: SensorFindings[] = [];
  readonly removed: string[] = [];
  readonly commits = new Map<
    string,
    {
      stored: Map<string, StoredFindings>;
      overlays: Map<string, StoredOverlay>;
    }
  >();
  readonly staged = new Map<
    string,
    { document: SensorFindings; overlay: AccumulatedOverlay | null }
  >();
  unitCache: UnitCache = {};

  holdCommit(
    commit: string,
    stored: StoredFindings,
    overlay?: StoredOverlay,
  ): void {
    const held = this.commits.get(commit) ?? {
      stored: new Map(),
      overlays: new Map(),
    };

    held.stored.set(stored.name, stored);

    if (overlay !== undefined) {
      held.overlays.set(overlay.name, overlay);
    }

    this.commits.set(commit, held);
  }

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

  readOverlays(): StoredOverlay[] {
    return [...this.storedOverlays.values()].sort((a, b) =>
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
    this.storedOverlays.delete(sensor);
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

  stage(
    _root: string,
    scope: RunScope,
    document: SensorFindings,
    overlay: AccumulatedOverlay | null,
  ): void {
    this.staged.set(`${scopeKey(scope)}::${document.sensor.name}`, {
      document,
      overlay,
    });
  }

  settle(
    _root: string,
    scope: RunScope,
    name: string,
    _ending: SettleEnding,
  ): "replaced" | "kept" {
    const key = `${scopeKey(scope)}::${name}`;
    const staged = this.staged.get(key);

    if (staged === undefined) {
      return "kept";
    }

    this.staged.delete(key);

    const text = `overlay of ${name}`;
    const stored: StoredFindings = {
      name,
      status: "read",
      document: staged.document,
    };
    const overlay: StoredOverlay | undefined =
      staged.overlay === null ? undefined : { name, status: "read", text };

    if (scope.kind === "commit") {
      this.holdCommit(scope.commit, stored, overlay);

      return "replaced";
    }

    this.stored.set(name, stored);

    if (overlay !== undefined) {
      this.storedOverlays.set(name, overlay);
    }

    return "replaced";
  }

  readCommits(): CommitResults[] {
    return [...this.commits.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([commit, held]) => ({
        commit,
        stored: [...held.stored.values()],
        overlays: [...held.overlays.values()],
      }));
  }

  removeCommit(_root: string, commit: string): void {
    this.commits.delete(commit);
  }
}

function scopeKey(scope: RunScope): string {
  return scope.kind === "working-tree" ? "working-tree" : scope.commit;
}
