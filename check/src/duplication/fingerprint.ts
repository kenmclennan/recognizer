import { createHash } from "node:crypto";
import type { Normalised } from "./normalise.js";

export const FINGERPRINT_DEPTH = 3;

export function serialise(node: Normalised, depth: number): string {
  const [label, children] = node;

  if (depth === 0 || children.length === 0) {
    return label;
  }

  const inner = children.map((child) => serialise(child, depth - 1)).join(",");

  return `${label}(${inner})`;
}

export function digest(text: string): string {
  return createHash("sha1")
    .update(text, "utf8")
    .digest()
    .subarray(0, 8)
    .toString("hex");
}

export function fingerprints(root: Normalised): Set<string> {
  const found = new Set<string>();
  const stack: Normalised[] = [root];

  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    found.add(digest(serialise(node, FINGERPRINT_DEPTH)));
    stack.push(...node[1]);
  }

  return found;
}
