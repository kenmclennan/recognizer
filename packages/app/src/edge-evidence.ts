import type { Dependency } from "@recognizer/core";

const LISTED = 3;

export function describeEdge(edge: Dependency): string {
  if (edge.inferred) {
    return `inferred: ${edge.inferred.parameter}.${edge.inferred.methods.join(", ")}, ${edge.inferred.class}`;
  }

  if (edge.kind !== "depends") {
    return `${edge.member ?? edge.from} ${edge.kind} ${edge.toMember ?? edge.to}`;
  }

  return edge.names && edge.names.length > 0
    ? `uses ${edge.names.join(", ")}`
    : `imports ${edge.to}`;
}

export function describeLine(edges: Dependency[]): string {
  if (edges.length === 1) {
    return describeEdge(edges[0] as Dependency);
  }

  const shown = edges.slice(0, LISTED).map(describeEdge).join("; ");

  return `${edges.length} dependencies: ${shown}${edges.length > LISTED ? "; ..." : ""}`;
}
