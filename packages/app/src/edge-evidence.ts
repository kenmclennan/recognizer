import type { ScanEdge } from "recognizer";

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
