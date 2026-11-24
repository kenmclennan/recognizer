export interface KeyedEmpty {
  kind: "empty";
}

export interface KeyedScalar {
  kind: "scalar";
  value: unknown;
}

export interface KeyedOther {
  kind: "other";
}

export interface KeyedSection {
  kind: "section";
  names(): string[];
  has(name: string): boolean;
  get(name: string): KeyedNode;
  entries(): { name: string; node: KeyedNode }[];
  setScalar(name: string, value: string | number | boolean): void;
  setSection(name: string, flow: boolean): KeyedSection;
  setList(name: string): KeyedList;
  remove(name: string): void;
  unflow(): void;
  json(): string;
}

export interface KeyedList {
  kind: "list";
  items(): KeyedNode[];
  addScalar(value: string | number | boolean): void;
  addEntry(identity: string, name: string): KeyedSection;
  removeAt(at: number): void;
  unflow(): void;
}

export type KeyedNode =
  | KeyedEmpty
  | KeyedScalar
  | KeyedOther
  | KeyedSection
  | KeyedList;

export interface KeyedDocument {
  root(): KeyedNode;
  createRoot(kind: "section" | "list"): KeyedSection | KeyedList;
  emit(): string;
}

export type Rewrite =
  | { op: "remove-key"; name: string }
  | {
      op: "append-rules";
      name: string;
      rules: { from: string[]; to: string[] }[];
    }
  | { op: "fold-into-list"; from: string; list: string; items: string[] }
  | { op: "keep-header" };

export interface KeyedText {
  open(text: string, subject: string): KeyedDocument | { refused: string };
  plain(text: string): { value: unknown } | { invalid: string };
  rewrite(text: string, rewrites: Rewrite[]): string;
}
