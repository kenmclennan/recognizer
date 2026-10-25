import type { ScanEdge } from "recognizer";

export type EvidenceSection = {
  where: string;
  quoted: string;
  names: string | null;
  route: string | null;
  inferred: string[];
};

const LISTED = 3;

export function describeEdge(edge: ScanEdge): string {
  if (edge.inferred) {
    return `inferred: ${edge.inferred.parameter}.${edge.inferred.methods.join(", ")}, ${edge.inferred.class}`;
  }

  if (edge.kind !== "depends") {
    return `${edge.member ?? edge.from} ${edge.kind} ${edge.to_member ?? edge.to}`;
  }

  return edge.names && edge.names.length > 0
    ? `uses ${edge.names.join(", ")}`
    : `imports ${edge.to}`;
}

export function describeLine(edges: ScanEdge[]): string {
  if (edges.length === 1) {
    return describeEdge(edges[0] as ScanEdge);
  }

  const shown = edges.slice(0, LISTED).map(describeEdge).join("; ");

  return `${edges.length} dependencies: ${shown}${edges.length > LISTED ? "; ..." : ""}`;
}

export const QUOTE_UNAVAILABLE = "source line unavailable";

export function evidenceOf(
  edge: ScanEdge,
  quotedLine: string | null,
): EvidenceSection {
  return {
    where: `${edge.from}:${edge.line}`,
    quoted: quotedLine ?? QUOTE_UNAVAILABLE,
    names: edge.names && edge.names.length > 0 ? edge.names.join(", ") : null,
    route: edge.via && edge.via.length > 0 ? edge.via.join(" -> ") : null,
    inferred: edge.inferred
      ? [
          `parameter: ${edge.inferred.parameter}`,
          `methods called: ${edge.inferred.methods.join(", ")}`,
          `matched class: ${edge.inferred.class}`,
          `known implementations: ${edge.inferred.implementations.join(", ")}`,
        ]
      : [],
  };
}
