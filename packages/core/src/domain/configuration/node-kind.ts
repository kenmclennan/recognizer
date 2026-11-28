export type NodeKind = "empty" | "scalar" | "other" | "section" | "list";

export function describeNodeKind(kind: NodeKind): string {
  if (kind === "section") {
    return "a section";
  }

  if (kind === "list") {
    return "a list";
  }

  return "a scalar";
}
