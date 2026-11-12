import {
  buildFreshness,
  type Finding,
  type FindingsDocument,
  findingsByModuleFrom,
  InputError,
  identityKey,
  measuredModules,
  type Policy,
  type PolicyProblem,
  parseBaseline,
  parsePolicy,
  policyProblems,
  ruleText,
  splitFindings,
  type Violation,
  violationText,
} from "recognizer";
import type { Loaded } from "./scan-loading";
import type { FolderNode, TreeNode } from "./tree-model";

export type { Finding };

export type Disc = "red" | "amber" | "grey" | "green";

export type Health = {
  documents: FindingsDocument[];
  hidden: FindingsDocument[];
  disc: (id: string) => Disc;
  lines: (id: string) => string[];
  findings: (id: string) => Finding[];
  notices: string[];
  policyProblems: PolicyProblem[];
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
  > &
    Partial<Pick<Loaded, "tests">>,
): Health {
  const notices: string[] = [];
  const known = new Set(loaded.modules);
  const policy = readPolicy(loaded.policy);
  const accepted = readBaseline(loaded.baseline ?? null, notices);
  const scans = loaded.scans.map(({ scan }) => scan);
  const freshness = buildFreshness(scans, loaded.tests ?? null);
  const measured = new Set<string>();
  const shown: FindingsDocument[] = [];
  const hidden: FindingsDocument[] = [];

  for (const document of loaded.findings) {
    const { current: keep, hidden: drop } = splitFindings(document, freshness);

    shown.push({ ...document, findings: keep });

    if (drop.length > 0) {
      hidden.push({ ...document, findings: drop });
    }

    const covered =
      document.sensor.name === "structure"
        ? measuredModules(scans, policy)
        : known;

    for (const id of covered) {
      if (
        document.inputs?.[id] !== undefined &&
        freshness.current(document, id)
      ) {
        measured.add(id);
      }
    }
  }

  const visible = shown.map((document) => ({
    ...document,
    findings: document.findings.filter(
      (record) =>
        record.severity !== "violation" || !accepted.has(identityKey(record)),
    ),
  }));
  const byModule = findingsByModuleFrom(visible);

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
