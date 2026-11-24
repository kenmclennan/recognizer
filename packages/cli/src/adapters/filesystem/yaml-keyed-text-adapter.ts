import type {
  KeyedDocument,
  KeyedList,
  KeyedNode,
  KeyedSection,
  KeyedText,
  Rewrite,
} from "@recognizer/core";
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

function scalarText(node: unknown): string {
  return isScalar(node) ? String(node.value ?? "") : "";
}

function wrap(doc: Document, node: unknown): KeyedNode {
  if (node === null || node === undefined) {
    return { kind: "empty" };
  }

  if (isScalar(node)) {
    return node.value === null
      ? { kind: "empty" }
      : { kind: "scalar", value: node.value };
  }

  if (isMap(node)) {
    return new YamlSection(doc, node);
  }

  if (isSeq(node)) {
    return new YamlList(doc, node);
  }

  return { kind: "other" };
}

class YamlSection implements KeyedSection {
  readonly kind = "section";

  constructor(
    private readonly doc: Document,
    private readonly map: YAMLMap,
  ) {}

  names(): string[] {
    return this.map.items.map((pair) => String((pair.key as Scalar).value));
  }

  has(name: string): boolean {
    return this.map.has(name);
  }

  get(name: string): KeyedNode {
    return wrap(this.doc, this.map.get(name, true));
  }

  entries(): { name: string; node: KeyedNode }[] {
    return this.map.items.map((pair) => ({
      name: scalarText(pair.key),
      node: wrap(this.doc, pair.value),
    }));
  }

  setScalar(name: string, value: string | number | boolean): void {
    this.map.set(name, value);
  }

  setSection(name: string, flow: boolean): KeyedSection {
    const made = new YAMLMap();

    if (flow) {
      made.flow = true;
    }

    this.map.set(name, made);

    return new YamlSection(this.doc, made);
  }

  setList(name: string): KeyedList {
    const made = new YAMLSeq();

    this.map.set(name, made);

    return new YamlList(this.doc, made);
  }

  remove(name: string): void {
    this.map.delete(name);
  }

  unflow(): void {
    if (this.map.items.length === 0 && this.map.flow) {
      this.map.flow = false;
    }
  }

  json(): string {
    return JSON.stringify(this.map.toJSON());
  }
}

class YamlList implements KeyedList {
  readonly kind = "list";

  constructor(
    private readonly doc: Document,
    private readonly seq: YAMLSeq,
  ) {}

  items(): KeyedNode[] {
    return this.seq.items.map((item) => wrap(this.doc, item));
  }

  addScalar(value: string | number | boolean): void {
    this.seq.add(this.doc.createNode(value));
  }

  addEntry(identity: string, name: string): KeyedSection {
    const entry = new YAMLMap();

    entry.set(identity, name);
    this.seq.add(entry);

    return new YamlSection(this.doc, entry);
  }

  removeAt(at: number): void {
    this.seq.items.splice(at, 1);
  }

  unflow(): void {
    if (this.seq.items.length === 0 && this.seq.flow) {
      this.seq.flow = false;
    }
  }
}

class YamlDocument implements KeyedDocument {
  constructor(
    private readonly doc: Document,
    private readonly source: string,
  ) {}

  root(): KeyedNode {
    return wrap(this.doc, this.doc.contents);
  }

  createRoot(kind: "section" | "list"): KeyedSection | KeyedList {
    if (kind === "section") {
      const made = new YAMLMap();

      this.doc.contents = made;

      return new YamlSection(this.doc, made);
    }

    const made = new YAMLSeq();

    this.doc.contents = made;

    return new YamlList(this.doc, made);
  }

  emit(): string {
    return emit(this.doc, this.source);
  }
}

function flowSeq(doc: Document, items: string[]): YAMLSeq {
  const seq = doc.createNode(items) as YAMLSeq;

  seq.flow = true;

  return seq;
}

function ruleNode(
  doc: Document,
  rule: { from: string[]; to: string[] },
): YAMLMap {
  const node = doc.createNode({}) as YAMLMap;

  node.set("from", flowSeq(doc, rule.from));
  node.set("to", flowSeq(doc, rule.to));

  return node;
}

function appendRules(
  doc: Document,
  name: string,
  rules: { from: string[]; to: string[] }[],
): void {
  const root = doc.contents as YAMLMap;
  const existing = root.get(name, true);

  if (isSeq(existing)) {
    for (const rule of rules) {
      existing.add(ruleNode(doc, rule));
    }

    return;
  }

  const seq = new YAMLSeq();

  for (const rule of rules) {
    seq.add(ruleNode(doc, rule));
  }

  root.set(name, seq);
}

function foldIntoList(
  doc: Document,
  from: string,
  list: string,
  items: string[],
): void {
  const root = doc.contents as YAMLMap;
  const source = root.items.find(
    (pair) => (pair.key as { value?: unknown }).value === from,
  );
  const existing = root.get(list, true);

  if (isSeq(existing)) {
    for (const item of items) {
      if (
        !existing.items.some(
          (candidate) => (candidate as { value?: unknown }).value === item,
        )
      ) {
        existing.add(doc.createNode(item));
      }
    }

    if (source !== undefined) {
      root.delete(from);
    }

    return;
  }

  if (source !== undefined) {
    source.key = doc.createNode(list);
    source.value = items.length > 0 ? doc.createNode(items) : null;

    if (items.length === 0) {
      root.delete(list);
    }

    return;
  }

  if (items.length > 0) {
    root.set(list, doc.createNode(items));
  }
}

function headerOf(doc: Document): string | undefined {
  const root = doc.contents as YAMLMap;

  return (root.items[0]?.key as { commentBefore?: string } | undefined)
    ?.commentBefore;
}

function keepHeader(doc: Document, header: string | undefined): void {
  const root = doc.contents as YAMLMap;
  const first = root.items[0] as { key: unknown } | undefined;

  if (first !== undefined && typeof first.key === "string") {
    first.key = doc.createNode(first.key);
  }

  const head = first?.key as
    | { spaceBefore?: boolean; commentBefore?: string }
    | undefined;

  if (head !== undefined) {
    head.spaceBefore = false;

    if (header !== undefined && head.commentBefore === undefined) {
      head.commentBefore = header;
    }
  }
}

export class YamlKeyedTextAdapter implements KeyedText {
  open(text: string, subject: string): KeyedDocument | { refused: string } {
    const doc = parseDocument(text);
    const first = doc.errors[0];

    return first === undefined
      ? new YamlDocument(doc, text)
      : { refused: `the ${subject} is not valid YAML: ${first.message}` };
  }

  plain(text: string): { value: unknown } | { invalid: string } {
    const doc = parseDocument(text);
    const first = doc.errors[0];

    return first === undefined
      ? { value: doc.toJS() }
      : { invalid: first.message };
  }

  rewrite(text: string, rewrites: Rewrite[]): string {
    const doc = parseDocument(text);

    if (doc.contents === null) {
      doc.contents = doc.createNode({}) as never;
    }

    const header = headerOf(doc);

    for (const rewrite of rewrites) {
      if (rewrite.op === "remove-key") {
        (doc.contents as YAMLMap).delete(rewrite.name);
      } else if (rewrite.op === "append-rules") {
        appendRules(doc, rewrite.name, rewrite.rules);
      } else if (rewrite.op === "fold-into-list") {
        foldIntoList(doc, rewrite.from, rewrite.list, rewrite.items);
      } else {
        keepHeader(doc, header);
      }
    }

    return emit(doc, text);
  }
}
