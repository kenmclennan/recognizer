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

export interface Member {
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
