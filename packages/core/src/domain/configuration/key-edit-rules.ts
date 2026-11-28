import { inWarnings, type Step } from "./edit-step.js";
import { describeNodeKind, type NodeKind } from "./node-kind.js";
import {
  findKey,
  findSection,
  type PublishedKey,
  type PublishedKeys,
  type PublishedSection,
} from "./published-keys.js";
import { retiredKeyFor } from "./retired-keys.js";

export type KeyResolution =
  | { found: PublishedKey }
  | { reason: string; isSection: boolean };

export type SectionResolution =
  | { found: PublishedSection }
  | { reason: string };

export type EditVerb = "set" | "add" | "unset";

export type RetiredUnsetDecision =
  | { kind: "none" }
  | { kind: "unset-retired"; path: string[] }
  | { kind: "refused"; reason: string };

export function keyIsSectionRefusal(key: string): string {
  return `${key} is a section, not a key`;
}

export function resolveKey(
  published: PublishedKeys,
  typed: string[],
): KeyResolution {
  const key = findKey(published, typed);

  if ("found" in key) {
    return key;
  }

  const section = findSection(published, typed);

  if ("found" in section) {
    return { reason: keyIsSectionRefusal(typed.join(".")), isSection: true };
  }

  return { reason: key.reason, isSection: false };
}

export function resolveSection(
  published: PublishedKeys,
  raw: string,
  typed: string[],
): SectionResolution {
  const found = findSection(published, typed);

  if ("found" in found) {
    return found;
  }

  const key = findKey(published, typed);

  return {
    reason:
      "found" in key
        ? `${raw} is a key, not a section; remove it with --unset`
        : found.reason,
  };
}

export function retiredWriteRefusal(
  key: string,
  resolved: boolean,
): string | null {
  const retired = retiredKeyFor(key);

  if (retired !== undefined && (resolved || key !== retired.path.join("."))) {
    return retired.message;
  }

  return null;
}

export function retiredUnsetDecision(
  key: string,
  raw: string | undefined,
): RetiredUnsetDecision {
  const retired = retiredKeyFor(key);

  if (retired === undefined) {
    return { kind: "none" };
  }

  return raw === undefined && key === retired.path.join(".")
    ? { kind: "unset-retired", path: retired.path }
    : { kind: "refused", reason: retired.message };
}

export function valueCountRefusal(
  verb: EditVerb,
  key: string,
  multi: boolean,
): string | null {
  if (verb === "set" && multi) {
    return `${key} holds a list; add an item with --add`;
  }

  if (verb === "add" && !multi) {
    return `${key} holds one value; set it without --add`;
  }

  if (verb === "unset" && !multi) {
    return `${key} holds one value; unset it without a value`;
  }

  return null;
}

export function switchesToMap(
  existingKind: NodeKind,
  entryType: PublishedKey["type"],
  steps: Step[],
): boolean {
  return (
    existingKind === "section" &&
    entryType === "boolean" &&
    inWarnings(steps, steps.length)
  );
}

export function occupantRefusal(
  key: string,
  existingKind: NodeKind,
  switches: boolean,
): string | null {
  if (existingKind === "empty" || existingKind === "scalar" || switches) {
    return null;
  }

  const remedy =
    existingKind === "section"
      ? "remove it with --remove-section first"
      : "remove it with --unset first";

  return `${key} is ${describeNodeKind(existingKind)}; ${remedy}`;
}

export function notAListRefusal(key: string, kind: NodeKind): string {
  return `${key} is ${describeNodeKind(kind)}, not a list`;
}

export function notASectionRefusal(section: string, kind: NodeKind): string {
  return `${section} is ${describeNodeKind(kind)}, not a section`;
}

export function descentRefusal(facts: {
  parent: string;
  subject: string;
  found: NodeKind;
  wantsList: boolean;
}): string {
  const where = facts.parent === "" ? `the ${facts.subject}` : facts.parent;
  const wanted = facts.wantsList ? "a list of entries" : "a section";

  return `${where} is ${describeNodeKind(facts.found)}, not ${wanted}`;
}

export function unreachableRefusal(
  verb: "set" | "add" | "add-section",
  name: string,
): string {
  if (verb === "set") {
    return `${name} cannot be set here`;
  }

  return verb === "add"
    ? `${name} cannot be added to here`
    : `${name} cannot be added here`;
}

export function sectionUnsetRefusal(key: string): string {
  return `${key} is a section; remove it with --remove-section`;
}

export function forbidRuleRemoval(
  subject: PublishedKeys["subject"],
  key: string,
  existingKind: NodeKind,
  raw: string,
): boolean {
  return (
    subject === "policy" &&
    key === "forbid" &&
    existingKind === "list" &&
    (raw.startsWith("forbid={") || raw.startsWith("{"))
  );
}

export function forbidRuleText(raw: string): string {
  return raw.replace(/^forbid=/, "");
}

export function dropsEmptyHolder(steps: Step[]): boolean {
  return inWarnings(steps, steps.length - 1) || steps[0]?.name === "describer";
}
