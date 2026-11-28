import {
  guardRegistration,
  inWarnings,
  type Step,
  stepsFor,
} from "../../domain/configuration/edit-step.js";
import {
  descentRefusal,
  dropsEmptyHolder,
  forbidRuleRemoval,
  forbidRuleText,
  keyIsSectionRefusal,
  notAListRefusal,
  notASectionRefusal,
  occupantRefusal,
  resolveKey,
  resolveSection,
  retiredUnsetDecision,
  retiredWriteRefusal,
  sectionUnsetRefusal,
  switchesToMap,
  unreachableRefusal,
  valueCountRefusal,
} from "../../domain/configuration/key-edit-rules.js";
import {
  entryNameFor,
  isForbidList,
  isUnlistableName,
  renderListItem,
  renderScalar,
} from "../../domain/configuration/key-listing-rules.js";
import {
  parseKeyPath,
  splitKeyPath,
} from "../../domain/configuration/key-path.js";
import { typedValue } from "../../domain/configuration/key-value.js";
import {
  findSection,
  type PublishedKey,
  type PublishedKeys,
  type PublishedSection,
} from "../../domain/configuration/published-keys.js";
import type {
  KeyedDocument,
  KeyedList,
  KeyedNode,
  KeyedSection,
  KeyedText,
} from "./ports/keyed-text.js";

export type EditOutcome =
  | { status: "ok"; text: string }
  | { status: "absent" }
  | { status: "refused"; reason: string };

export type KeyReadOutcome =
  | { status: "ok"; lines: string[] }
  | { status: "absent" }
  | { status: "refused"; reason: string };

export interface Listing {
  lines: string[];
  skipped: string[];
}

type Holder = { section: KeyedSection; name: string } | null;

type Descent =
  | { container: KeyedSection | KeyedList; holder: Holder }
  | { absent: true }
  | { refused: string };

type Opened = { doc: KeyedDocument } | { refused: string };

function refuse(reason: string): { status: "refused"; reason: string } {
  return { status: "refused", reason };
}

function open(keyed: KeyedText, text: string, subject: string): Opened {
  const opened = keyed.open(text, subject);

  return "refused" in opened ? opened : { doc: opened };
}

function entryIndex(list: KeyedList, step: Step & { kind: "entry" }): number {
  return list.items().findIndex((item) => {
    if (item.kind !== "section") {
      return false;
    }

    const identity = item.get(step.identity);

    return identity.kind === "scalar" && String(identity.value) === step.name;
  });
}

function descend(
  doc: KeyedDocument,
  steps: Step[],
  create: boolean,
  subject: string,
): Descent {
  let node: KeyedNode = doc.root();
  let place = (kind: "section" | "list"): KeyedSection | KeyedList =>
    doc.createRoot(kind);
  let holder: Holder = null;

  for (const [at, step] of steps.entries()) {
    const wantSeq = step.kind === "entry";

    if (
      create &&
      !wantSeq &&
      node.kind === "scalar" &&
      typeof node.value === "boolean" &&
      inWarnings(steps, at)
    ) {
      node = place("section");
    }

    if (node.kind === "empty") {
      if (!create) {
        return { absent: true };
      }

      node = place(wantSeq ? "list" : "section");
    }

    if (wantSeq ? node.kind !== "list" : node.kind !== "section") {
      const parent = steps
        .slice(0, at)
        .map((entry) => entry.name)
        .join(".");

      return {
        refused: descentRefusal({
          parent,
          subject,
          found: node.kind,
          wantsList: wantSeq,
        }),
      };
    }

    const container = node as KeyedSection | KeyedList;

    if (create) {
      container.unflow();
    }

    if (at === steps.length - 1) {
      return { container, holder };
    }

    if (step.kind === "key") {
      const section = container as KeyedSection;

      holder = { section, name: step.name };
      place = (kind) =>
        kind === "section"
          ? section.setSection(step.name, false)
          : section.setList(step.name);
      node = section.get(step.name);

      continue;
    }

    const list = container as KeyedList;
    let index = entryIndex(list, step);

    if (index === -1) {
      if (!create) {
        return { absent: true };
      }

      list.addEntry(step.identity, step.name);
      index = list.items().length - 1;
    }

    const item = list.items()[index] as KeyedNode;

    place = () => item as KeyedSection;
    node = item;
  }

  return { absent: true };
}

function lastStep(steps: Step[]): Step {
  return steps[steps.length - 1] as Step;
}

function prepared(
  keyed: KeyedText,
  published: PublishedKeys,
  key: string,
  text: string,
): { typed: string[]; entry: PublishedKey; doc: KeyedDocument } | EditOutcome {
  const parsed = parseKeyPath(key, "key");

  if ("reason" in parsed) {
    return refuse(parsed.reason);
  }

  const typed = parsed.path;
  const entry = resolveKey(published, typed);
  const retired = retiredWriteRefusal(key, "found" in entry);

  if (retired !== null) {
    return refuse(retired);
  }

  if (!("found" in entry)) {
    return refuse(entry.reason);
  }

  const opened = open(keyed, text, published.subject);

  if ("refused" in opened) {
    return refuse(opened.refused);
  }

  return { typed, entry: entry.found, doc: opened.doc };
}

function isFailure(value: unknown): value is EditOutcome {
  return typeof value === "object" && value !== null && "status" in value;
}

export function setKeyValue(
  keyed: KeyedText,
  text: string,
  published: PublishedKeys,
  key: string,
  raw: string,
): EditOutcome {
  const base = prepared(keyed, published, key, text);

  if (isFailure(base)) {
    return base;
  }

  const { typed, entry, doc } = base;

  const countRefusal = valueCountRefusal("set", key, entry.multi === true);

  if (countRefusal !== null) {
    return refuse(countRefusal);
  }

  const value = typedValue(entry, raw);

  if ("reason" in value) {
    return refuse(value.reason);
  }

  const steps = stepsFor(published, typed);
  const descent = descend(doc, steps, true, published.subject);

  if ("refused" in descent) {
    return refuse(descent.refused);
  }

  if (!("container" in descent) || descent.container.kind !== "section") {
    return refuse(unreachableRefusal("set", key));
  }

  const map = descent.container;
  const name = lastStep(steps).name;
  const existing = map.get(name);

  const occupied = occupantRefusal(
    key,
    existing.kind,
    switchesToMap(existing.kind, entry.type, steps),
  );

  if (occupied !== null) {
    return refuse(occupied);
  }

  const conflict = guardRegistration(published, typed, entry, map.names());

  if (conflict !== null) {
    return refuse(conflict);
  }

  if (existing.kind === "scalar" && existing.value === value.value) {
    return { status: "ok", text };
  }

  map.setScalar(name, value.value);

  return { status: "ok", text: doc.emit() };
}

export function addKeyValue(
  keyed: KeyedText,
  text: string,
  published: PublishedKeys,
  key: string,
  raw: string,
): EditOutcome {
  const base = prepared(keyed, published, key, text);

  if (isFailure(base)) {
    return base;
  }

  const { typed, entry, doc } = base;

  const countRefusal = valueCountRefusal("add", key, entry.multi === true);

  if (countRefusal !== null) {
    return refuse(countRefusal);
  }

  const value = typedValue(entry, raw);

  if ("reason" in value) {
    return refuse(value.reason);
  }

  const steps = stepsFor(published, typed);
  const descent = descend(doc, steps, true, published.subject);

  if ("refused" in descent) {
    return refuse(descent.refused);
  }

  if (!("container" in descent) || descent.container.kind !== "section") {
    return refuse(unreachableRefusal("add", key));
  }

  const map = descent.container;
  const name = lastStep(steps).name;
  const existing = map.get(name);
  const conflict = guardRegistration(published, typed, entry, map.names());

  if (conflict !== null) {
    return refuse(conflict);
  }

  if (existing.kind === "empty") {
    map.setList(name).addScalar(value.value);

    return { status: "ok", text: doc.emit() };
  }

  if (existing.kind !== "list") {
    return refuse(notAListRefusal(key, existing.kind));
  }

  const present = existing
    .items()
    .some((item) => item.kind === "scalar" && item.value === value.value);

  if (present) {
    return { status: "ok", text };
  }

  existing.unflow();
  existing.addScalar(value.value);

  return { status: "ok", text: doc.emit() };
}

function unsetRetired(
  keyed: KeyedText,
  text: string,
  path: string[],
): EditOutcome {
  const opened = open(keyed, text, "config");

  if ("refused" in opened) {
    return refuse(opened.refused);
  }

  const sections = (depth: number): KeyedSection | null => {
    let at: KeyedNode = opened.doc.root();

    for (const step of path.slice(0, depth)) {
      if (at.kind !== "section") {
        return null;
      }

      at = at.get(step);
    }

    return at.kind === "section" ? at : null;
  };

  const parent = sections(path.length - 1);
  const leaf = path[path.length - 1] as string;

  if (parent === null || !parent.has(leaf)) {
    return { status: "absent" };
  }

  parent.remove(leaf);

  for (let depth = path.length - 1; depth > 0; depth -= 1) {
    const holder = sections(depth);

    if (holder === null || holder.names().length > 0) {
      break;
    }

    const above = sections(depth - 1) as KeyedSection;

    above.remove(path[depth - 1] as string);
  }

  return { status: "ok", text: opened.doc.emit() };
}

function unsetForbidRule(
  doc: KeyedDocument,
  text: string,
  map: KeyedSection,
  name: string,
  existing: KeyedList,
  raw: string,
): EditOutcome {
  const wanted = forbidRuleText(raw);

  const at = existing
    .items()
    .findIndex((item) => item.kind === "section" && item.json() === wanted);

  if (at === -1) {
    return { status: "absent" };
  }

  existing.removeAt(at);

  if (existing.items().length === 0) {
    map.remove(name);
  }

  return { status: "ok", text: doc.emit() };
}

export function unsetKeyValue(
  keyed: KeyedText,
  text: string,
  published: PublishedKeys,
  key: string,
  raw?: string,
): EditOutcome {
  const typed = splitKeyPath(key);
  const retired = retiredUnsetDecision(key, raw);

  if (retired.kind === "unset-retired") {
    return unsetRetired(keyed, text, retired.path);
  }

  if (retired.kind === "refused") {
    return refuse(retired.reason);
  }

  const entry = resolveKey(published, typed);

  if (!("found" in entry)) {
    return refuse(entry.isSection ? sectionUnsetRefusal(key) : entry.reason);
  }

  const opened = open(keyed, text, published.subject);

  if ("refused" in opened) {
    return refuse(opened.refused);
  }

  const doc = opened.doc;
  const steps = stepsFor(published, typed);
  const descent = descend(doc, steps, false, published.subject);

  if ("refused" in descent) {
    return refuse(descent.refused);
  }

  if (!("container" in descent) || descent.container.kind !== "section") {
    return { status: "absent" };
  }

  const map = descent.container;
  const name = lastStep(steps).name;
  const existing = map.get(name);

  if (existing.kind === "empty" && !map.has(name)) {
    return { status: "absent" };
  }

  if (existing.kind === "section") {
    return refuse(sectionUnsetRefusal(key));
  }

  if (raw === undefined) {
    map.remove(name);

    if (
      map.names().length === 0 &&
      descent.holder !== null &&
      dropsEmptyHolder(steps)
    ) {
      descent.holder.section.remove(descent.holder.name);
    }

    return { status: "ok", text: doc.emit() };
  }

  const countRefusal = valueCountRefusal(
    "unset",
    key,
    entry.found.multi === true,
  );

  if (countRefusal !== null) {
    return refuse(countRefusal);
  }

  if (
    existing.kind === "list" &&
    forbidRuleRemoval(published.subject, key, existing.kind, raw)
  ) {
    return unsetForbidRule(doc, text, map, name, existing, raw);
  }

  const value = typedValue(entry.found, raw);

  if ("reason" in value) {
    return refuse(value.reason);
  }

  if (existing.kind !== "list") {
    return { status: "absent" };
  }

  const at = existing
    .items()
    .findIndex((item) => item.kind === "scalar" && item.value === value.value);

  if (at === -1) {
    return { status: "absent" };
  }

  existing.removeAt(at);

  if (existing.items().length === 0) {
    map.remove(name);
  }

  return { status: "ok", text: doc.emit() };
}

function sectionOf(
  published: PublishedKeys,
  section: string,
): { typed: string[]; found: PublishedSection } | EditOutcome {
  const parsed = parseKeyPath(section, "section");

  if ("reason" in parsed) {
    return refuse(parsed.reason);
  }

  const typed = parsed.path;
  const found = resolveSection(published, section, typed);

  return "found" in found
    ? { typed, found: found.found }
    : refuse(found.reason);
}

export function removeKeySection(
  keyed: KeyedText,
  text: string,
  published: PublishedKeys,
  section: string,
): EditOutcome {
  const base = sectionOf(published, section);

  if (isFailure(base)) {
    return base;
  }

  const opened = open(keyed, text, published.subject);

  if ("refused" in opened) {
    return refuse(opened.refused);
  }

  const doc = opened.doc;
  const steps = stepsFor(published, base.typed);
  const descent = descend(doc, steps, false, published.subject);

  if ("refused" in descent) {
    return refuse(descent.refused);
  }

  if (!("container" in descent)) {
    return { status: "absent" };
  }

  const step = lastStep(steps);

  if (step.kind === "key") {
    const map = descent.container as KeyedSection;

    if (!map.has(step.name)) {
      return { status: "absent" };
    }

    map.remove(step.name);

    return { status: "ok", text: doc.emit() };
  }

  const list = descent.container as KeyedList;
  const index = entryIndex(list, step);

  if (index === -1) {
    return { status: "absent" };
  }

  list.removeAt(index);

  if (list.items().length === 0 && descent.holder !== null) {
    descent.holder.section.remove(descent.holder.name);
  }

  return { status: "ok", text: doc.emit() };
}

export function addKeySection(
  keyed: KeyedText,
  text: string,
  published: PublishedKeys,
  section: string,
): EditOutcome {
  const base = sectionOf(published, section);

  if (isFailure(base)) {
    return base;
  }

  const opened = open(keyed, text, published.subject);

  if ("refused" in opened) {
    return refuse(opened.refused);
  }

  const doc = opened.doc;
  const steps = stepsFor(published, base.typed);
  const step = lastStep(steps);
  const probe = descend(doc, steps, false, published.subject);

  if ("refused" in probe) {
    return refuse(probe.refused);
  }

  if ("container" in probe) {
    if (
      step.kind === "entry" &&
      entryIndex(probe.container as KeyedList, step) !== -1
    ) {
      return { status: "ok", text };
    }

    if (step.kind === "key") {
      const existing = (probe.container as KeyedSection).get(step.name);

      if (existing.kind === "section") {
        return { status: "ok", text };
      }

      if (existing.kind !== "empty") {
        return refuse(notASectionRefusal(section, existing.kind));
      }
    }
  }

  const descent = descend(doc, steps, true, published.subject);

  if ("refused" in descent) {
    return refuse(descent.refused);
  }

  if (!("container" in descent)) {
    return refuse(unreachableRefusal("add-section", section));
  }

  if (step.kind === "key") {
    (descent.container as KeyedSection).setSection(step.name, true);
  }

  if (step.kind === "entry") {
    (descent.container as KeyedList).addEntry(step.identity, step.name);
  }

  return { status: "ok", text: doc.emit() };
}

export function readKeyValue(
  keyed: KeyedText,
  text: string,
  published: PublishedKeys,
  key: string,
): KeyReadOutcome {
  const typed = splitKeyPath(key);
  const entry = resolveKey(published, typed);

  if (!("found" in entry)) {
    return refuse(entry.reason);
  }

  const opened = open(keyed, text, published.subject);

  if ("refused" in opened) {
    return refuse(opened.refused);
  }

  const steps = stepsFor(published, typed);
  const descent = descend(opened.doc, steps, false, published.subject);

  if ("refused" in descent) {
    return refuse(descent.refused);
  }

  if (!("container" in descent) || descent.container.kind !== "section") {
    return { status: "absent" };
  }

  const value = descent.container.get(lastStep(steps).name);

  if (value.kind === "empty") {
    return { status: "absent" };
  }

  if (value.kind === "scalar") {
    return { status: "ok", lines: [String(value.value)] };
  }

  if (value.kind === "list") {
    return {
      status: "ok",
      lines: value.items().map((item) => renderListItem(item)),
    };
  }

  return refuse(keyIsSectionRefusal(key));
}

function scalarText(node: KeyedNode): string {
  return node.kind === "scalar" ? renderScalar(node.value) : "";
}

export function listKeyed(
  keyed: KeyedText,
  text: string,
  published: PublishedKeys,
): Listing {
  const opened = open(keyed, text, published.subject);

  if ("refused" in opened) {
    return { lines: [], skipped: [opened.refused] };
  }

  const lines: string[] = [];
  const skipped: string[] = [];

  const walk = (map: KeyedSection, prefix: string[], hidden?: string): void => {
    const entries = map.entries();

    if (prefix.length > 0 && entries.every((entry) => entry.name === hidden)) {
      lines.push(`${prefix.join(".")}=`);
    }

    for (const { name, node } of entries) {
      if (name === hidden) {
        continue;
      }

      const path = [...prefix, name];
      const label = path.join(".");

      if (isUnlistableName(name)) {
        skipped.push(label);
      } else if (node.kind === "section") {
        walk(node, path);
      } else if (node.kind === "list") {
        walkList(node, path);
      } else if (node.kind === "scalar" || node.kind === "empty") {
        lines.push(`${label}=${scalarText(node)}`);
      }
    }
  };

  const walkList = (list: KeyedList, path: string[]): void => {
    for (const item of list.items()) {
      if (item.kind === "section" && isForbidList(published.subject, path)) {
        lines.push(`forbid=${item.json()}`);

        continue;
      }

      if (item.kind !== "section") {
        lines.push(`${path.join(".")}=${scalarText(item)}`);

        continue;
      }

      const sections = findSection(published, [
        ...path,
        entryNameFor(published, path, (identity) =>
          scalarText(item.get(identity)),
        ),
      ]);

      if (!("found" in sections) || sections.found.shape !== "list-entry") {
        skipped.push(path.join("."));

        return;
      }

      const identity = sections.found.identity as string;

      walk(item, [...path, scalarText(item.get(identity))], identity);
    }
  };

  const root = opened.doc.root();

  if (root.kind === "section") {
    walk(root, []);
  }

  return { lines, skipped: [...new Set(skipped)] };
}
