import {
  findingsStanding,
  type Principle,
  type SensorFindings,
  type Violation,
} from "@recognizer/core";
import {
  type FindingNote,
  findingsByModuleFrom,
  narrowViolationRecord,
  type PolicyProblem,
  policyProblems,
  ruleText,
  violationText,
} from "recognizer";
import type { Loaded } from "./scan-loading";
import type { FolderNode, TreeNode } from "./tree-model";

export type { FindingNote };

export type Disc = "red" | "amber" | "grey" | "green";

export type Health = {
  documents: SensorFindings[];
  hidden: SensorFindings[];
  disc: (id: string) => Disc;
  lines: (id: string) => string[];
  findings: (id: string) => FindingNote[];
  notices: string[];
  policyProblems: PolicyProblem[];
};

export type NodeHealth = { disc: Disc; hover: string };

const MAX_HOVER_LINES = 10;
const RANK: Record<Disc, number> = { green: 0, grey: 1, amber: 2, red: 3 };

export function violationLine(violation: Violation): string {
  return `violation: ${violationText(violation)} (${ruleText(violation.rule)})`;
}

export function computeHealth(
  loaded: Pick<
    Loaded,
    | "repository"
    | "policy"
    | "modules"
    | "baseline"
    | "findings"
    | "split"
    | "measured"
  > &
    Partial<Pick<Loaded, "baselineProblem">>,
  published: readonly Principle[],
): Health {
  const notices: string[] = [];
  const known = new Set(loaded.modules);
  const policy = loaded.policy;
  const accepted = new Set(loaded.baseline ?? []);

  if (loaded.baselineProblem != null) {
    notices.push(`baseline: ${loaded.baselineProblem}`);
  }

  const scans = loaded.repository;
  const measured = new Set(Object.values(loaded.measured).flat());
  const shown: SensorFindings[] = [];
  const hidden: SensorFindings[] = [];

  for (const document of loaded.findings) {
    const name = document.sensor.name;
    const { shown: keep, hidden: drop } = loaded.split[name];

    shown.push({ ...document, findings: keep });

    if (drop.length > 0) {
      hidden.push({ ...document, findings: drop });
    }
  }

  const visible = shown.map((document) => ({
    ...document,
    findings: document.findings.flatMap((record) => {
      if (record.severity !== "violation") {
        return [record];
      }

      const narrowed = narrowViolationRecord(record, accepted);

      return narrowed === null ? [] : [narrowed];
    }),
  }));
  const byModule = findingsByModuleFrom(visible, published);

  const findingsOf = (id: string) =>
    known.has(id) ? (byModule.get(id) ?? []) : [];
  const linesOf = (id: string) =>
    findingsOf(id).map((finding) =>
      finding.severity === "violation"
        ? `violation: ${finding.text} (${finding.why})`
        : finding.text,
    );

  return {
    documents: visible,
    hidden,
    disc: (id) => {
      const found = findingsOf(id);

      return findingsStanding(found).level === "violation"
        ? "red"
        : found.length > 0
          ? "amber"
          : measured.has(id)
            ? "green"
            : "grey";
    },
    lines: linesOf,
    findings: findingsOf,
    notices,
    policyProblems: policyProblems(scans, policy),
  };
}

function hoverText(lines: string[], fallback: string): string {
  if (lines.length === 0) {
    return fallback;
  }

  const shown = lines.slice(0, MAX_HOVER_LINES);
  const rest = lines.length - shown.length;

  return [...shown, ...(rest > 0 ? [`and ${rest} more`] : [])].join("\n");
}

type Entry = { path: string; line: string };

function walk(
  node: TreeNode,
  health: Health,
  into: Map<string, NodeHealth>,
): { disc: Disc; entries: Entry[] } {
  if (node.kind === "file") {
    const disc = health.disc(node.path);
    const lines = health.lines(node.path);
    const fallback = disc === "grey" ? "not measured" : "no findings";

    into.set(node.path, { disc, hover: hoverText(lines, fallback) });

    return { disc, entries: lines.map((line) => ({ path: node.name, line })) };
  }

  let worst: Disc = "green";
  const entries: Entry[] = [];

  for (const child of node.children) {
    const result = walk(child, health, into);

    if (RANK[result.disc] > RANK[worst]) {
      worst = result.disc;
    }

    for (const entry of result.entries) {
      entries.push({
        path:
          child.kind === "file" ? entry.path : `${child.name}/${entry.path}`,
        line: entry.line,
      });
    }
  }

  const fallback =
    worst === "grey" ? "some files are not measured" : "no findings";
  const lines = entries.map((entry) => `${entry.path}: ${entry.line}`);

  into.set(node.path, { disc: worst, hover: hoverText(lines, fallback) });

  return { disc: worst, entries };
}

export function describeTree(
  root: FolderNode,
  health: Health,
): Map<string, NodeHealth> {
  const into = new Map<string, NodeHealth>();

  walk(root, health, into);

  return into;
}
