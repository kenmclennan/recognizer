import { InvalidEntity } from "./invalid-entity.js";

export type MemberTag =
  | "property"
  | "static"
  | "classmethod"
  | "abstract"
  | "async";

export type ClassTag =
  | "dataclass"
  | "frozen"
  | "final"
  | "runtime_checkable"
  | "abstract"
  | "sealed";

export interface Parameter {
  readonly name: string;
  readonly type?: string;
}

export interface Field {
  readonly name: string;
  readonly type?: string;
  readonly line: number;
  readonly private: boolean;
}

export interface Method {
  readonly name: string;
  readonly line?: number;
  readonly endLine?: number;
  readonly bodyLine?: number;
  readonly params?: readonly Parameter[];
  readonly returns?: string;
  readonly private?: boolean;
  readonly tags?: readonly MemberTag[];
}

export interface MemberFields {
  readonly name: string;
  readonly exported: boolean;
  readonly visibility?: "public" | "protected" | "internal" | "private";
  readonly kind?:
    | "class"
    | "function"
    | "interface"
    | "type"
    | "constant"
    | "enum";
  readonly line?: number;
  readonly endLine?: number;
  readonly bodyLine?: number;
  readonly bases?: readonly string[];
  readonly fields?: readonly Field[];
  readonly methods?: readonly Method[];
  readonly params?: readonly Parameter[];
  readonly returns?: string;
  readonly tags?: readonly MemberTag[] | readonly ClassTag[];
  readonly value?: string;
}

export class Member {
  declare readonly name: string;
  declare readonly exported: boolean;
  declare readonly visibility?: MemberFields["visibility"];
  declare readonly kind?: MemberFields["kind"];
  declare readonly line?: number;
  declare readonly endLine?: number;
  declare readonly bodyLine?: number;
  declare readonly bases?: readonly string[];
  declare readonly fields?: readonly Field[];
  declare readonly methods?: readonly Method[];
  declare readonly params?: readonly Parameter[];
  declare readonly returns?: string;
  declare readonly tags?: MemberFields["tags"];
  declare readonly value?: string;

  constructor(fields: MemberFields) {
    if (fields.name === "") {
      throw new InvalidEntity("Member", "name is empty", fields.name);
    }

    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        (this as Record<string, unknown>)[key] = value;
      }
    }
  }

  method(name: string): Method | undefined {
    return this.methods?.find((method) => method.name === name);
  }

  field(name: string): Field | undefined {
    return this.fields?.find((field) => field.name === name);
  }
}
