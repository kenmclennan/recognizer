import { InvalidEntity } from "./invalid-entity.js";
import type { Language } from "./language.js";

export interface DependencyFields {
  readonly from: string;
  readonly to: string;
  readonly toLibrary: boolean;
  readonly language: Language;
  readonly kind: "depends" | "declares" | "inherits" | "implements";
  readonly line: number;
  readonly names?: readonly string[];
  readonly via?: readonly string[];
  readonly member?: string;
  readonly toMember?: string;
  readonly inferred?: {
    readonly parameter: string;
    readonly methods: readonly string[];
    readonly class: string;
    readonly implementations: readonly string[];
  };
}

export class Dependency {
  readonly from: string;
  readonly to: string;
  readonly toLibrary: boolean;
  readonly language: Language;
  readonly kind: DependencyFields["kind"];
  readonly line: number;
  declare readonly names?: readonly string[];
  declare readonly via?: readonly string[];
  declare readonly member?: string;
  declare readonly toMember?: string;
  declare readonly inferred?: DependencyFields["inferred"];

  constructor(fields: DependencyFields) {
    if (fields.from === "") {
      throw new InvalidEntity("Dependency", "from is empty", fields.from);
    }

    if (fields.to === "") {
      throw new InvalidEntity("Dependency", "to is empty", fields.to);
    }

    this.from = fields.from;
    this.to = fields.to;
    this.toLibrary = fields.toLibrary;
    this.language = fields.language;
    this.kind = fields.kind;
    this.line = fields.line;

    if (fields.names !== undefined) this.names = fields.names;
    if (fields.via !== undefined) this.via = fields.via;
    if (fields.member !== undefined) this.member = fields.member;
    if (fields.toMember !== undefined) this.toMember = fields.toMember;
    if (fields.inferred !== undefined) this.inferred = fields.inferred;
  }

  get countsAsEdge(): boolean {
    return this.kind !== "declares";
  }
}

const FOREIGN_PREFIX = "foreign:";

export class Library {
  readonly id: string;
  readonly name: string;

  constructor(fields: { readonly id: string; readonly name: string }) {
    this.id = fields.id;
    this.name = fields.name;
  }

  static owns(id: string): boolean {
    return id.startsWith(FOREIGN_PREFIX);
  }
}

export interface Call {
  readonly from: string;
  readonly to: string;
  readonly line: number;
  readonly how: "call" | "construct" | "inferred" | "dispatch";
}

export interface UnresolvedImport {
  readonly from: string;
  readonly import: string;
  readonly line: number;
}

export interface TestImport {
  readonly from: string;
  readonly to: string;
  readonly names?: readonly string[];
}
