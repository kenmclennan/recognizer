import type { MarkedModule, MemberMarkKind, Scan } from "recognizer";
import { moduleOf } from "recognizer";
import type { MetricDescriptor, OverlayModel } from "./overlay-model";
import { largest } from "./overlay-model";
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
          entry.mark === "modified" &&
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
