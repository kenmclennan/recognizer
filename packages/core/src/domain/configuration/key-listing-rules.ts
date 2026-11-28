import type { NodeKind } from "./node-kind.js";
import { findSection, type PublishedKeys } from "./published-keys.js";

export function isUnlistableName(name: string): boolean {
  return name.includes(".") || name === "";
}

export function isForbidList(
  subject: PublishedKeys["subject"],
  path: string[],
): boolean {
  return subject === "policy" && path.length === 1 && path[0] === "forbid";
}

export function renderScalar(value: unknown): string {
  return String(value ?? "");
}

export function renderListItem(item: {
  kind: NodeKind;
  value?: unknown;
  json?: () => string;
}): string {
  if (item.kind === "scalar") {
    return String(item.value);
  }

  if (item.kind === "section") {
    return (item.json as () => string)();
  }

  return item.kind === "empty" ? "null" : "";
}

export function entryNameFor(
  published: PublishedKeys,
  path: string[],
  identityValueOf: (identity: string) => string,
): string {
  for (const section of published.sections) {
    if (section.shape === "list-entry" && section.identity !== undefined) {
      const name = identityValueOf(section.identity);

      if (name !== "" && "found" in findSection(published, [...path, name])) {
        return name;
      }
    }
  }

  return "";
}
