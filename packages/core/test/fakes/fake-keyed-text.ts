import type {
  KeyedDocument,
  KeyedList,
  KeyedNode,
  KeyedSection,
  KeyedText,
  Rewrite,
} from "../../src/index.js";

type Bag = Record<string, unknown>;

function wrap(value: unknown): KeyedNode {
  if (value === null || value === undefined) {
    return { kind: "empty" };
  }

  if (Array.isArray(value)) {
    return new FakeList(value);
  }

  if (typeof value === "object") {
    return new FakeSection(value as Bag);
  }

  return { kind: "scalar", value };
}

class FakeSection implements KeyedSection {
  readonly kind = "section";

  constructor(private readonly bag: Bag) {}

  names(): string[] {
    return Object.keys(this.bag);
  }

  has(name: string): boolean {
    return name in this.bag;
  }

  get(name: string): KeyedNode {
    return wrap(this.bag[name]);
  }

  entries(): { name: string; node: KeyedNode }[] {
    return Object.entries(this.bag).map(([name, value]) => ({
      name,
      node: wrap(value),
    }));
  }

  setScalar(name: string, value: string | number | boolean): void {
    this.bag[name] = value;
  }

  setSection(name: string): KeyedSection {
    const made: Bag = {};

    this.bag[name] = made;

    return new FakeSection(made);
  }

  setList(name: string): KeyedList {
    const made: unknown[] = [];

    this.bag[name] = made;

    return new FakeList(made);
  }

  remove(name: string): void {
    delete this.bag[name];
  }

  unflow(): void {}

  json(): string {
    return JSON.stringify(this.bag);
  }
}

class FakeList implements KeyedList {
  readonly kind = "list";

  constructor(private readonly array: unknown[]) {}

  items(): KeyedNode[] {
    return this.array.map(wrap);
  }

  addScalar(value: string | number | boolean): void {
    this.array.push(value);
  }

  addEntry(identity: string, name: string): KeyedSection {
    const entry: Bag = { [identity]: name };

    this.array.push(entry);

    return new FakeSection(entry);
  }

  removeAt(at: number): void {
    this.array.splice(at, 1);
  }

  unflow(): void {}
}

class FakeDocument implements KeyedDocument {
  constructor(private value: unknown) {}

  root(): KeyedNode {
    return wrap(this.value);
  }

  createRoot(kind: "section" | "list"): KeyedSection | KeyedList {
    if (kind === "section") {
      const made: Bag = {};

      this.value = made;

      return new FakeSection(made);
    }

    const made: unknown[] = [];

    this.value = made;

    return new FakeList(made);
  }

  emit(): string {
    return JSON.stringify(this.value, null, 2);
  }
}

function parse(text: string): { value: unknown } | { invalid: string } {
  if (text.trim() === "") {
    return { value: null };
  }

  try {
    return { value: JSON.parse(text) as unknown };
  } catch (error) {
    return { invalid: (error as Error).message };
  }
}

export class FakeKeyedText implements KeyedText {
  open(text: string, subject: string): KeyedDocument | { refused: string } {
    const read = parse(text);

    return "invalid" in read
      ? { refused: `the ${subject} is not valid YAML: ${read.invalid}` }
      : new FakeDocument(read.value);
  }

  plain(text: string): { value: unknown } | { invalid: string } {
    return parse(text);
  }

  rewrite(text: string, rewrites: Rewrite[]): string {
    const read = parse(text);
    const root: Bag =
      "value" in read && read.value !== null ? (read.value as Bag) : {};

    for (const rewrite of rewrites) {
      if (rewrite.op === "remove-key") {
        delete root[rewrite.name];
      } else if (rewrite.op === "append-rules") {
        const list = (root[rewrite.name] ?? []) as unknown[];

        list.push(...rewrite.rules);
        root[rewrite.name] = list;
      } else if (rewrite.op === "fold-into-list") {
        const existing = root[rewrite.list];
        const list = Array.isArray(existing) ? existing : [];

        for (const item of rewrite.items) {
          if (!list.includes(item)) {
            list.push(item);
          }
        }

        delete root[rewrite.from];

        if (list.length > 0) {
          root[rewrite.list] = list;
        }
      }
    }

    return JSON.stringify(root, null, 2);
  }
}
