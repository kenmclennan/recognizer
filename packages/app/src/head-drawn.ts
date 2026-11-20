import type { MarkedModule, MemberMarkKind, Scan } from "recognizer";
import { moduleOf } from "recognizer";
import type { MetricDescriptor, OverlayModel } from "./overlay-model";
import { largest } from "./overlay-model";
import type { ResponsibilityRow } from "./responsibility-model";
import { currentCommit } from "./stale-report";

type Tracked = Scan & { modified?: boolean | null };

export type HeadDrawnInputs = {
  scans: Scan[];
  headCommit: string;
  marked: MarkedModule[];
  marks: Map<string, Map<string, MemberMarkKind> | null>;
  head: Scan[];
};

function checkoutIsCleanHead(scans: Scan[], headCommit: string): boolean {
  return (
    currentCommit(scans) === headCommit &&
    (scans as Tracked[]).every((scan) => scan.modified === false)
  );
}

export function headDrawn(inputs: HeadDrawnInputs): ReadonlySet<string> {
  if (checkoutIsCleanHead(inputs.scans, inputs.headCommit)) {
    return new Set();
  }

  const held = new Set(
    inputs.head.flatMap((scan) => scan.modules.map((entry) => entry.id)),
  );

  return new Set(
    inputs.marked
      .filter(
        (entry) =>
          (entry.mark === "modified" || entry.mark === "renamed") &&
          entry.box === "current" &&
          inputs.marks.get(entry.id) !== undefined &&
          inputs.marks.get(entry.id) !== null &&
          held.has(entry.id),
      )
      .map((entry) => entry.id),
  );
}

export function drawnScans(
  scans: Scan[],
  drawn: ReadonlySet<string>,
  headScans: Scan[],
): Scan[] {
  if (drawn.size === 0) {
    return scans;
  }

  const fromHead = new Map(
    headScans.flatMap((scan) => scan.modules.map((entry) => [entry.id, entry])),
  );

  return scans.map((scan) => ({
    ...scan,
    modules: scan.modules.map((entry) =>
      drawn.has(entry.id) ? (fromHead.get(entry.id) ?? entry) : entry,
    ),
  }));
}

export function addedFromHead(
  scans: Scan[],
  marked: MarkedModule[],
  head: Scan[],
): Scan[] {
  const held = new Set(
    scans.flatMap((scan) => scan.modules.map((entry) => entry.id)),
  );
  const wanted = new Set(
    marked
      .filter(
        (entry) =>
          entry.mark === "added" &&
          entry.box === "current" &&
          !held.has(entry.id),
      )
      .map((entry) => entry.id),
  );

  if (wanted.size === 0) {
    return scans;
  }

  const modules = head.flatMap((scan) =>
    scan.modules.filter((entry) => wanted.has(entry.id)),
  );

  if (modules.length === 0) {
    return scans;
  }

  const ids = new Set(modules.map((entry) => entry.id));
  const edges = head.flatMap((scan) =>
    scan.edges.filter((edge) => ids.has(edge.from)),
  );

  return [...scans, { modules, edges, foreign: [] } as unknown as Scan];
}

export function withoutDrawn(
  model: OverlayModel,
  drawn: ReadonlySet<string>,
): OverlayModel {
  if (drawn.size === 0) {
    return model;
  }

  const metrics: MetricDescriptor[] = model.metrics.map((metric) => {
    const values = Object.fromEntries(
      Object.entries(metric.values).filter(
        ([key]) => !drawn.has(moduleOf(key)),
      ),
    );

    return { ...metric, values, max: largest(values) };
  });

  return { ...model, metrics };
}

export function withoutDrawnResponsibility(
  responsibility: (id: string) => ResponsibilityRow,
  drawn: ReadonlySet<string>,
): (id: string) => ResponsibilityRow {
  if (drawn.size === 0) {
    return responsibility;
  }

  return (id) =>
    drawn.has(id)
      ? { state: { kind: "missing" }, failure: null }
      : responsibility(id);
}
