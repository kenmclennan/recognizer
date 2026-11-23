import type { Language } from "./language.js";
import type { Member } from "./member.js";

export interface File {
  readonly path: string;
  readonly language: Language;
  readonly folder: string | null;
  readonly kind: "source" | "package" | "interface";
  readonly hash: string | null;
  readonly members: readonly Member[];
  readonly entryPoint: boolean;
  readonly annotations: readonly string[];
  readonly actualOf: readonly string[];
}
