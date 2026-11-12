import {
  type Document,
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  type Scalar,
  YAMLMap,
  YAMLSeq,
} from "yaml";
import {
  findKey,
  findSection,
  type KeyEntry,
  type PublishedKey,
  type PublishedKeys,
  type PublishedSection,
  REGISTRATION_KEY,
} from "./config-keys.js";

export type EditOutcome =
  | { status: "ok"; text: string }
  | { status: "absent" }
  | { status: "refused"; reason: string };

export type ReadOutcome =
  | { status: "ok"; lines: string[] }
  | { status: "absent" }
  | { status: "refused"; reason: string };

export interface Listing {
  lines: string[];
  skipped: string[];
}

type Step =
  | { kind: "key"; name: string }
  | { kind: "entry"; identity: string; name: string };

type Holder = { map: YAMLMap; name: string } | null;

type Descent =
  | { container: YAMLMap | YAMLSeq; holder: Holder }
  | { absent: true }
  | { refused: string };

type Typed = { value: string | number | boolean } | { reason: string };

type Opened = { doc: Document } | { refused: string };

function refuse(reason: string): { status: "refused"; reason: string } {
  return { status: "refused", reason };
}

function indentOf(text: string): number {
  const line = text
    .split("\n")
    .find((candidate) => /^ +\S/.test(candidate) && !/^ *#/.test(candidate));

  return line === undefined ? 2 : line.length - line.trimStart().length;
}

function emit(doc: Document, source: string): string {
  return doc.toString({
    flowCollectionPadding: false,
    indent: indentOf(source),
    lineWidth: 0,
  });
}

function open(text: string, subject: string): Opened {
  const doc = parseDocument(text);
  const first = doc.errors[0];

  return first === undefined
    ? { doc }
    : { refused: `the ${subject} is not valid YAML: ${first.message}` };
}

function isEmptyValue(node: unknown): boolean {
  return (
    node === null ||
    node === undefined ||
    (isScalar(node) && node.value === null)
  );
}

function describeNode(node: unknown): string {
  if (isMap(node)) {
    return "a section";
  }

  if (isSeq(node)) {
    return "a list";
  }

  return "a scalar";
}

export function typedValue(entry: KeyEntry, raw: string): Typed {
  const number = (): number | null =>
    /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(raw) &&
    Number.isFinite(Number(raw))
      ? Number(raw)
      : null;

  if (entry.type === "boolean") {
    return raw === "true" || raw === "false"
      ? { value: raw === "true" }
      : { reason: `${raw} is not true or false` };
  }

  if (entry.type === "enum") {
    const values = entry.values ?? [];

    return values.includes(raw)
      ? { value: raw }
      : {
          reason: `${raw} is not allowed; allowed values: ${values.join(", ")}`,
        };
  }

  if (entry.type === "integer" || entry.type === "number") {
    if (entry.type === "integer" && !/^[+-]?\d+$/.test(raw)) {
      return { reason: `${raw} is not an integer` };
    }

    const parsed = number();

    if (parsed === null) {
      return { reason: `${raw} is not a number` };
    }

    const bound = outOfBounds(entry, parsed, raw);

    return bound === null ? { value: parsed } : { reason: bound };
  }

  if (raw === "") {
    return { reason: "must not be empty" };
  }

  if (entry.type === "path") {
    if (raw.startsWith("/")) {
      return {
        reason: `${raw} is absolute; it must be relative to the repository`,
      };
    }

    if (raw.split("/").includes("..")) {
      return { reason: `${raw} must not contain a .. segment` };
    }
  }

  return { value: raw };
}

function outOfBounds(
  entry: KeyEntry,
  value: number,
  raw: string,
): string | null {
  if (entry.minimum !== undefined && value < entry.minimum) {
    return `${raw} is below the minimum ${entry.minimum}`;
  }

  if (entry.exclusiveMinimum !== undefined && value <= entry.exclusiveMinimum) {
    return `${raw} must be above ${entry.exclusiveMinimum}`;
  }

  if (entry.maximum !== undefined && value > entry.maximum) {
    return `${raw} is above the maximum ${entry.maximum}`;
  }

  if (entry.exclusiveMaximum !== undefined && value >= entry.exclusiveMaximum) {
    return `${raw} must be below ${entry.exclusiveMaximum}`;
  }

  return null;
}

function stepsFor(published: PublishedKeys, typed: string[]): Step[] {
  return typed.map((name, at): Step => {
    const found = findSection(published, typed.slice(0, at + 1));

    if ("found" in found && found.found.shape === "list-entry") {
      return {
        kind: "entry",
        identity: found.found.identity as string,
        name,
      };
    }

    return { kind: "key", name };
  });
}

function unflow(node: YAMLMap | YAMLSeq): void {
  if (node.items.length === 0 && node.flow) {
    node.flow = false;
  }
}

function entryNamed(
  seq: YAMLSeq,
  step: Step & { kind: "entry" },
): YAMLMap | null {
  for (const item of seq.items) {
    if (isMap(item) && String(item.get(step.identity)) === step.name) {
      return item;
    }
  }

  return null;
}

function descend(
  doc: Document,
  steps: Step[],
  create: boolean,
  subject: string,
): Descent {
  let node: unknown = doc.contents;
  let place = (made: YAMLMap | YAMLSeq): void => {
    doc.contents = made;
  };
  let holder: Holder = null;

  for (const [at, step] of steps.entries()) {
    const wantSeq = step.kind === "entry";
    if (isEmptyValue(node)) {
      if (!create) {
        return { absent: true };
      }

      const made = wantSeq ? new YAMLSeq() : new YAMLMap();

      place(made);
      node = made;
    }

    if (wantSeq ? !isSeq(node) : !isMap(node)) {
      const parent = steps
        .slice(0, at)
        .map((entry) => entry.name)
        .join(".");

      return {
        refused: `${parent === "" ? `the ${subject}` : parent} is ${describeNode(node)}, not ${wantSeq ? "a list of entries" : "a section"}`,
      };
    }

    const container = node as YAMLMap | YAMLSeq;

    if (create) {
      unflow(container);
    }

    if (at === steps.length - 1) {
      return { container, holder };
    }

    if (step.kind === "key") {
      const map = container as YAMLMap;
      const child = map.get(step.name, true);

      holder = { map, name: step.name };
      place = (made) => {
        map.set(step.name, made);
      };
      node = child;

      continue;
    }

    const seq = container as YAMLSeq;
    let item = entryNamed(seq, step);

    if (item === null) {
      if (!create) {
        return { absent: true };
      }

      item = new YAMLMap();
      item.set(step.identity, step.name);
      seq.add(item);
    }

    place = () => {};
    node = item;
  }

  return { absent: true };
}

function lastStep(steps: Step[]): Step {
  return steps[steps.length - 1] as Step;
}

function keyOf(
  published: PublishedKeys,
  typed: string[],
): { found: PublishedKey } | { reason: string } {
  const key = findKey(published, typed);

  if ("found" in key) {
    return key;
  }

  const section = findSection(published, typed);

  if ("found" in section) {
    return { reason: `${typed.join(".")} is a section, not a key` };
  }

  return { reason: key.reason };
}

function guardRegistration(
  published: PublishedKeys,
  typed: string[],
  entry: PublishedKey,
  container: YAMLMap,
): string | null {
  if (!published.keys.some((key) => key.key === REGISTRATION_KEY)) {
    return null;
  }

  const parent = findSection(published, typed.slice(0, -1));

  if (!("found" in parent) || parent.found.shape !== "map-entry") {
    return null;
  }

  const names = container.items.map((pair) =>
    String((pair.key as Scalar).value),
  );

  if (entry.key === REGISTRATION_KEY) {
    return names.some((name) => name !== "command")
      ? `${typed.slice(0, -1).join(".")} holds settings; a registration is either settings or a command`
      : null;
  }

  return names.includes("command")
    ? `${typed.slice(0, -1).join(".")} is registered with a command; a registration is either settings or a command`
    : null;
}

function prepared(
  published: PublishedKeys,
  key: string,
  text: string,
): { typed: string[]; entry: PublishedKey; doc: Document } | EditOutcome {
  const typed = key.split(".");

  if (typed.includes("")) {
    return refuse("a key is dotted names with none empty");
  }

  const entry = keyOf(published, typed);

  if (!("found" in entry)) {
    return refuse(entry.reason);
  }

  const opened = open(text, published.subject);

  if ("refused" in opened) {
    return refuse(opened.refused);
  }

  return { typed, entry: entry.found, doc: opened.doc };
}

function isFailure(value: unknown): value is EditOutcome {
  return typeof value === "object" && value !== null && "status" in value;
}

export function setValue(
  text: string,
  published: PublishedKeys,
  key: string,
  raw: string,
): EditOutcome {
  const base = prepared(published, key, text);

  if (isFailure(base)) {
    return base;
  }

  const { typed, entry, doc } = base;

  if (entry.multi === true) {
    return refuse(`${key} holds a list; add an item with --add`);
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

  if (!("container" in descent) || !isMap(descent.container)) {
    return refuse(`${key} cannot be set here`);
  }

  const map = descent.container;
  const name = lastStep(steps).name;
  const existing = map.get(name, true);

  if (!isEmptyValue(existing) && !isScalar(existing)) {
    return refuse(
      `${key} is ${describeNode(existing)}; ${isMap(existing) ? "remove it with --remove-section first" : "remove it with --unset first"}`,
    );
  }

  const conflict = guardRegistration(published, typed, entry, map);

  if (conflict !== null) {
    return refuse(conflict);
  }

  if (isScalar(existing) && existing.value === value.value) {
    return { status: "ok", text };
  }

  map.set(name, value.value);

  return { status: "ok", text: emit(doc, text) };
}

export function addValue(
  text: string,
  published: PublishedKeys,
  key: string,
  raw: string,
): EditOutcome {
  const base = prepared(published, key, text);

  if (isFailure(base)) {
    return base;
  }

  const { typed, entry, doc } = base;

  if (entry.multi !== true) {
    return refuse(`${key} holds one value; set it without --add`);
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

  if (!("container" in descent) || !isMap(descent.container)) {
    return refuse(`${key} cannot be added to here`);
  }

  const map = descent.container;
  const name = lastStep(steps).name;
  const existing = map.get(name, true);
  const conflict = guardRegistration(published, typed, entry, map);

  if (conflict !== null) {
    return refuse(conflict);
  }

  if (isEmptyValue(existing)) {
    const seq = new YAMLSeq();

    seq.add(doc.createNode(value.value));
    map.set(name, seq);

    return { status: "ok", text: emit(doc, text) };
  }

  if (!isSeq(existing)) {
    return refuse(`${key} is ${describeNode(existing)}, not a list`);
  }

  const present = existing.items.some(
    (item) => isScalar(item) && item.value === value.value,
  );

  if (present) {
    return { status: "ok", text };
  }

  unflow(existing);
  existing.add(doc.createNode(value.value));

  return { status: "ok", text: emit(doc, text) };
}

export function unsetValue(
  text: string,
  published: PublishedKeys,
  key: string,
  raw?: string,
): EditOutcome {
  const typed = key.split(".");
  const entry = keyOf(published, typed);

  if (!("found" in entry)) {
    return refuse(
      entry.reason.endsWith("is a section, not a key")
        ? `${key} is a section; remove it with --remove-section`
        : entry.reason,
    );
  }

  const opened = open(text, published.subject);

  if ("refused" in opened) {
    return refuse(opened.refused);
  }

  const doc = opened.doc;
  const steps = stepsFor(published, typed);
  const descent = descend(doc, steps, false, published.subject);

  if ("refused" in descent) {
    return refuse(descent.refused);
  }

  if (!("container" in descent) || !isMap(descent.container)) {
    return { status: "absent" };
  }

  const map = descent.container;
  const name = lastStep(steps).name;
  const existing = map.get(name, true);

  if (isEmptyValue(existing) && !map.has(name)) {
    return { status: "absent" };
  }

  if (isMap(existing)) {
    return refuse(`${key} is a section; remove it with --remove-section`);
  }

  if (raw === undefined) {
    map.delete(name);

    return { status: "ok", text: emit(doc, text) };
  }

  if (entry.found.multi !== true) {
    return refuse(`${key} holds one value; unset it without a value`);
  }

  const value = typedValue(entry.found, raw);

  if ("reason" in value) {
    return refuse(value.reason);
  }

  if (!isSeq(existing)) {
    return { status: "absent" };
  }

  const at = existing.items.findIndex(
    (item) => isScalar(item) && item.value === value.value,
  );

  if (at === -1) {
    return { status: "absent" };
  }

  existing.items.splice(at, 1);

  if (existing.items.length === 0) {
    map.delete(name);
  }

  return { status: "ok", text: emit(doc, text) };
}

function sectionOf(
  published: PublishedKeys,
  section: string,
): { typed: string[]; found: PublishedSection } | EditOutcome {
  const typed = section.split(".");

  if (typed.includes("")) {
    return refuse("a section is dotted names with none empty");
  }

  const found = findSection(published, typed);

  if ("found" in found) {
    return { typed, found: found.found };
  }

  const key = findKey(published, typed);

  return refuse(
    "found" in key
      ? `${section} is a key, not a section; remove it with --unset`
      : found.reason,
  );
}

export function removeSection(
  text: string,
  published: PublishedKeys,
  section: string,
): EditOutcome {
  const base = sectionOf(published, section);

  if (isFailure(base)) {
    return base;
  }

  const opened = open(text, published.subject);

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
    const map = descent.container as YAMLMap;

    if (!map.has(step.name)) {
      return { status: "absent" };
    }

    map.delete(step.name);

    return { status: "ok", text: emit(doc, text) };
  }

  const seq = descent.container as YAMLSeq;
  const item = entryNamed(seq, step);

  if (item === null) {
    return { status: "absent" };
  }

  seq.items.splice(seq.items.indexOf(item), 1);

  if (seq.items.length === 0 && descent.holder !== null) {
    descent.holder.map.delete(descent.holder.name);
  }

  return { status: "ok", text: emit(doc, text) };
}

export function addSection(
  text: string,
  published: PublishedKeys,
  section: string,
): EditOutcome {
  const base = sectionOf(published, section);

  if (isFailure(base)) {
    return base;
  }

  const opened = open(text, published.subject);

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
    if (step.kind === "entry" && entryNamed(probe.container as YAMLSeq, step)) {
      return { status: "ok", text };
    }

    if (step.kind === "key") {
      const existing = (probe.container as YAMLMap).get(step.name, true);

      if (isMap(existing)) {
        return { status: "ok", text };
      }

      if (!isEmptyValue(existing)) {
        return refuse(`${section} is ${describeNode(existing)}, not a section`);
      }
    }
  }

  const descent = descend(doc, steps, true, published.subject);

  if ("refused" in descent) {
    return refuse(descent.refused);
  }

  if (!("container" in descent)) {
    return refuse(`${section} cannot be added here`);
  }

  if (step.kind === "key") {
    const empty = new YAMLMap();

    empty.flow = true;
    (descent.container as YAMLMap).set(step.name, empty);
  }

  if (step.kind === "entry") {
    const entry = new YAMLMap();

    entry.set(step.identity, step.name);
    (descent.container as YAMLSeq).add(entry);
  }

  return { status: "ok", text: emit(doc, text) };
}

export function readKey(
  text: string,
  published: PublishedKeys,
  key: string,
): ReadOutcome {
  const typed = key.split(".");
  const entry = keyOf(published, typed);

  if (!("found" in entry)) {
    return refuse(entry.reason);
  }

  const opened = open(text, published.subject);

  if ("refused" in opened) {
    return refuse(opened.refused);
  }

  const steps = stepsFor(published, typed);
  const descent = descend(opened.doc, steps, false, published.subject);

  if ("refused" in descent) {
    return refuse(descent.refused);
  }

  if (!("container" in descent) || !isMap(descent.container)) {
    return { status: "absent" };
  }

  const value: unknown = descent.container.get(lastStep(steps).name, true);

  if (isEmptyValue(value)) {
    return { status: "absent" };
  }

  if (isScalar(value)) {
    return { status: "ok", lines: [String(value.value)] };
  }

  if (isSeq(value)) {
    return {
      status: "ok",
      lines: value.items.map((item) =>
        String(isScalar(item) ? item.value : item),
      ),
    };
  }

  return refuse(`${key} is a section, not a key`);
}

function scalarText(node: unknown): string {
  return isScalar(node) ? String(node.value ?? "") : "";
}

export function listKeys(text: string, published: PublishedKeys): Listing {
  const opened = open(text, published.subject);

  if ("refused" in opened) {
    return { lines: [], skipped: [opened.refused] };
  }

  const lines: string[] = [];
  const skipped: string[] = [];

  const walk = (map: YAMLMap, prefix: string[], hidden?: string): void => {
    for (const pair of map.items) {
      const name = scalarText(pair.key);

      if (name === hidden) {
        continue;
      }

      const path = [...prefix, name];
      const label = path.join(".");
      const value = pair.value;

      if (name.includes(".") || name === "") {
        skipped.push(label);
      } else if (isMap(value)) {
        walk(value, path);
      } else if (isSeq(value)) {
        walkList(value, path);
      } else if (isScalar(value)) {
        lines.push(`${label}=${scalarText(value)}`);
      }
    }
  };

  const walkList = (seq: YAMLSeq, path: string[]): void => {
    for (const item of seq.items) {
      if (!isMap(item)) {
        lines.push(`${path.join(".")}=${scalarText(item)}`);

        continue;
      }

      const sections = findSection(published, [
        ...path,
        entryName(published, path, item),
      ]);

      if (!("found" in sections) || sections.found.shape !== "list-entry") {
        skipped.push(path.join("."));

        return;
      }

      const identity = sections.found.identity as string;

      walk(item, [...path, scalarText(item.get(identity, true))], identity);
    }
  };

  const root = opened.doc.contents;

  if (isMap(root)) {
    walk(root, []);
  }

  return { lines, skipped: [...new Set(skipped)] };
}

function entryName(
  published: PublishedKeys,
  path: string[],
  item: YAMLMap,
): string {
  for (const section of published.sections) {
    if (section.shape === "list-entry" && section.identity !== undefined) {
      const name = scalarText(item.get(section.identity, true));

      if (name !== "" && "found" in findSection(published, [...path, name])) {
        return name;
      }
    }
  }

  return "";
}
