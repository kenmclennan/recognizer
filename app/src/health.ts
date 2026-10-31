import {
  type Finding,
  type FindingsDocument,
  findingsByModuleFrom,
  InputError,
  identityKey,
  measuredModules,
  type Policy,
  parseBaseline,
  parsePolicy,
  ruleText,
  type Violation,
  violationText,
} from "recognizer";
import type { Loaded } from "./scan-loading";
import { scansCommit } from "./sensor-run";
import type { FolderNode, TreeNode } from "./tree-model";

export type { Finding };

export type Disc = "red" | "amber" | "grey" | "green";

export type Health = {
  documents: FindingsDocument[];
  disc: (id: string) => Disc;
  lines: (id: string) => string[];
  findings: (id: string) => Finding[];
  notices: string[];
};

export type NodeHealth = { disc: Disc; hover: string };

const MAX_HOVER_LINES = 10;
const RANK: Record<Disc, number> = { green: 0, grey: 1, amber: 2, red: 3 };

export function violationLine(violation: Violation): string {
  return `violation: ${violationText(violation)} (${ruleText(violation)})`;
}

function messagesOf(error: unknown): string {
  return error instanceof InputError
    ? error.messages.join("; ")
    : (error as Error).message;
}

function readBaseline(text: string | null, notices: string[]): Set<string> {
  if (text === null) {
    return new Set();
  }

  try {
    return new Set(parseBaseline(text).map(identityKey));
  } catch (error) {
    notices.push(`baseline: ${messagesOf(error)}`);

    return new Set();
  }
}

function readPolicy(text: string | null): Policy | null {
  if (text === null) {
    return null;
  }

  try {
    return parsePolicy(text);
  } catch {
    return null;
  }
}

export function computeHealth(
  loaded: Pick<
    Loaded,
    "scans" | "policy" | "modules" | "baseline" | "findings"
  >,
): Health {
  const notices: string[] = [];
  const known = new Set(loaded.modules);
  const accepted = readBaseline(loaded.baseline ?? null, notices);
  const scans = loaded.scans.map(({ scan }) => scan);
  const { commit } = scansCommit(scans);
  const current = loaded.findings.filter(
    (document) => document.commit === (commit ?? ""),
  );
  const measured = new Set<string>();

  if (current.some((document) => document.sensor.name === "structure")) {
    for (const id of measuredModules(scans, readPolicy(loaded.policy))) {
      measured.add(id);
    }
  }

  const visible = current.map((document) => ({
    ...document,
    findings: document.findings.filter(
      (record) =>
        record.severity !== "violation" || !accepted.has(identityKey(record)),
    ),
  }));
  const byModule = findingsByModuleFrom(visible);

  for (const document of current) {
    for (const record of document.findings) {
      for (const id of record.evidence.modules) {
        measured.add(id);
      }
    }
  }

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
    disc: (id) => {
      const found = findingsOf(id);

      return found.some((finding) => finding.severity === "violation")
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
    worst === "grey" ? "some modules are not measured" : "no findings";
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
