import { Repository } from "@recognizer/core";
import type { MarkedFile, MemberMarkKind } from "recognizer";
import { moduleOf } from "recognizer";

export type { MarkedFile, MemberMarkKind };

import type { MetricDescriptor, OverlayModel } from "./overlay-model";
import { largest } from "./overlay-model";
import type { ResponsibilityRow } from "./responsibility-model";
import { currentCommit } from "./stale-report";

export type HeadDrawnInputs = {
  scans: Repository;
  headCommit: string;
  marked: MarkedFile[];
  marks: Map<string, Map<string, MemberMarkKind> | null>;
  head: Repository;
};

function checkoutIsCleanHead(scans: Repository, headCommit: string): boolean {
  return (
    currentCommit(scans) === headCommit &&
    scans.extractions.every((extraction) => extraction.modified === false)
  );
}

export function headDrawn(inputs: HeadDrawnInputs): ReadonlySet<string> {
  if (checkoutIsCleanHead(inputs.scans, inputs.headCommit)) {
    return new Set();
  }

  const held = new Set(inputs.head.files.map((entry) => entry.path));

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
  scans: Repository,
  drawn: ReadonlySet<string>,
  headScans: Repository,
): Repository {
  if (drawn.size === 0) {
    return scans;
  }

  const fromHead = new Map(headScans.files.map((entry) => [entry.path, entry]));

  return Repository.of({
    ...scans,
    files: scans.files.map((entry) =>
      drawn.has(entry.path) ? (fromHead.get(entry.path) ?? entry) : entry,
    ),
  });
}

export function addedFromHead(
  scans: Repository,
  marked: MarkedFile[],
  head: Repository,
): Repository {
  const held = new Set(scans.files.map((entry) => entry.path));
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

  const files = head.files.filter((entry) => wanted.has(entry.path));

  if (files.length === 0) {
    return scans;
  }

  const ids = new Set(files.map((entry) => entry.path));
  const dependencies = head.dependencies.filter((edge) => ids.has(edge.from));

  return Repository.join([scans, Repository.of({ files, dependencies })]);
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
