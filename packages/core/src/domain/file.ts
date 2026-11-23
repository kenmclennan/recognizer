import { InvalidEntity } from "./invalid-entity.js";
import type { Language } from "./language.js";
import type { Member } from "./member.js";

export type FileKind = "source" | "package" | "interface";

export interface FileFields {
  readonly path: string;
  readonly language: Language;
  readonly kind: FileKind;
  readonly hash: string | null;
  readonly members: readonly Member[];
  readonly entryPoint: boolean;
  readonly annotations: readonly string[];
  readonly actualOf: readonly string[];
}

const KINDS: readonly string[] = ["source", "package", "interface"];

export class File {
  readonly path: string;
  readonly language: Language;
  readonly kind: FileKind;
  readonly hash: string | null;
  readonly members: readonly Member[];
  readonly entryPoint: boolean;
  readonly annotations: readonly string[];
  readonly actualOf: readonly string[];

  constructor(fields: FileFields) {
    if (fields.path === "") {
      throw new InvalidEntity("File", "path is empty", fields.path);
    }

    if (fields.language === "") {
      throw new InvalidEntity("File", "language is empty", fields.language);
    }

    if (!KINDS.includes(fields.kind)) {
      throw new InvalidEntity("File", "kind is not known", fields.kind);
    }

    this.path = fields.path;
    this.language = fields.language;
    this.kind = fields.kind;
    this.hash = fields.hash;
    this.members = fields.members;
    this.entryPoint = fields.entryPoint;
    this.annotations = fields.annotations;
    this.actualOf = fields.actualOf;
  }

  get folder(): string | null {
    const at = this.path.lastIndexOf("/");

    return at === -1 ? null : this.path.slice(0, at);
  }

  static nameOf(path: string): string {
    return path.slice(path.lastIndexOf("/") + 1);
  }

  member(name: string): Member | undefined {
    return this.members.find((member) => member.name === name);
  }

  hasMember(name: string): boolean {
    return this.member(name) !== undefined;
  }

  holdsMemberNamed(name: string): boolean {
    if (this.hasMember(name)) {
      return true;
    }

    const owner = /^(.+?)(?:\.|::|#)/.exec(name)?.[1];

    return owner !== undefined && this.hasMember(owner);
  }
}
