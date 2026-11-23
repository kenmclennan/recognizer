import type { Language } from "./language.js";

export interface Dependency {
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

export interface Library {
  readonly id: string;
  readonly name: string;
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
