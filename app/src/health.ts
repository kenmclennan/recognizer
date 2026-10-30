import {
  analyse,
  collectViolations,
  InputError,
  identityKey,
  type Policy,
  parseBaseline,
  parsePolicy,
  type Violation,
} from "recognizer";
import type { LoadedScan } from "./scan-loading";
import type { FolderNode, TreeNode } from "./tree-model";

export type Disc = "red" | "amber" | "grey" | "green";

export type Finding = {
  severity: "violation" | "warning";
  text: string;
  why: string;
};

export type Health = {
  disc: (id: string) => Disc;
  lines: (id: string) => string[];
  findings: (id: string) => Finding[];
  notices: string[];
};

export type NodeHealth = { disc: Disc; hover: string };

const HUB_THRESHOLD = 10;
const MAX_HOVER_LINES = 10;
const RANK: Record<Disc, number> = { green: 0, grey: 1, amber: 2, red: 3 };

function ruleText(violation: Violation): string {
  const rule = violation.rules[0];

  if (rule === undefined) {
    return "";
  }

  if (rule.type === "level") {
    return `level ${rule.from_level} -> ${rule.to_level}`;
  }

  if (rule.type === "uses") {
    return `uses ${rule.from_component} -> ${rule.to_component}`;
  }

  return `forbid ${rule.pattern}`;
}

function violationText(violation: Violation): string {
  const verb = violation.kind === "depends" ? "depends on" : violation.kind;

  return `${verb} ${violation.to} at line ${violation.lines.join(", ")}`;
}

export function violationLine(violation: Violation): string {
  return `violation: ${violationText(violation)} (${ruleText(violation)})`;
}

function readPolicy(text: string | null, notices: string[]): Policy | null {
  if (text === null) {
    return null;
  }

  try {
    return parsePolicy(text);
  } catch (error) {
    notices.push(`policy.yaml: ${messagesOf(error)}`);

    return null;
  }
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

function violationsOf(
  scans: LoadedScan[],
  policy: Policy,
  accepted: Set<string>,
  notices: string[],
): Violation[][] | null {
  try {
    return scans.map(({ scan }) =>
      collectViolations(scan, policy).violations.filter(
        (violation) => !accepted.has(identityKey(violation)),
      ),
    );
  } catch (error) {
    notices.push(`policy.yaml: ${messagesOf(error)}`);

    return null;
  }
}

export function computeHealth(
  scans: LoadedScan[],
  policyText: string | null,
  moduleIds: Iterable<string>,
  baselineText: string | null = null,
): Health {
  const notices: string[] = [];
  const known = new Set(moduleIds);
  const parsed = readPolicy(policyText, notices);
  const accepted = readBaseline(parsed ? baselineText : null, notices);
  const violations = parsed
    ? violationsOf(scans, parsed, accepted, notices)
    : null;
  const policy = violations ? parsed : null;
  const reds = new Map<string, string[]>();
  const ambers = new Map<string, string[]>();
  const redFindings = new Map<string, Finding[]>();
  const amberFindings = new Map<string, Finding[]>();
  const measured = new Set<string>();

  function add<T>(target: Map<string, T[]>, id: string, entry: T) {
    if (known.has(id)) {
      target.set(id, [...(target.get(id) ?? []), entry]);
    }
  }

  scans.forEach(({ scan }, index) => {
    for (const violation of violations?.[index] ?? []) {
      add(reds, violation.from, violationLine(violation));
      add(redFindings, violation.from, {
        severity: "violation",
        text: violationText(violation),
        why: ruleText(violation),
      });
    }

    const analysis = analyse(scan, { hub: HUB_THRESHOLD }, policy?.ignore);

    for (const metric of analysis.metrics) {
      measured.add(metric.id);
    }

    for (const warning of analysis.warnings) {
      const ids =
        warning.id === "cycle"
          ? warning.evidence.modules
          : [warning.evidence.module];

      for (const id of ids) {
        add(ambers, id, warning.summary);
        add(amberFindings, id, {
          severity: "warning",
          text: warning.summary,
          why: warning.principle,
        });
      }
    }
  });

  const linesOf = (id: string) => [
    ...(reds.get(id) ?? []),
    ...(ambers.get(id) ?? []),
  ];

  return {
    disc: (id) =>
      reds.has(id)
        ? "red"
        : ambers.has(id)
          ? "amber"
          : measured.has(id)
            ? "green"
            : "grey",
    lines: linesOf,
    findings: (id) => [
      ...(redFindings.get(id) ?? []),
      ...(amberFindings.get(id) ?? []),
    ],
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
