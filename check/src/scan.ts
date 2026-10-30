import type { ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import { InputError } from "./errors.js";
import schema from "./generated/scan.schema.json" with { type: "json" };

export interface ScanEdge {
  from: string;
  to: string;
  kind: "depends" | "inherits" | "implements";
  line: number;
  names?: string[];
  via?: string[];
  member?: string;
  to_member?: string;
  inferred?: {
    parameter: string;
    methods: string[];
    class: string;
    implementations: string[];
  };
}

export type ScanTag =
  | "property"
  | "static"
  | "classmethod"
  | "abstract"
  | "async";

export type ScanClassTag =
  | "dataclass"
  | "frozen"
  | "final"
  | "runtime_checkable"
  | "abstract";

export interface ScanParam {
  name: string;
  type?: string;
}

export interface ScanField {
  name: string;
  type?: string;
  line: number;
  private: boolean;
}

export interface ScanMethod {
  name: string;
  line?: number;
  params?: ScanParam[];
  returns?: string;
  private?: boolean;
  tags?: ScanTag[];
}

export interface ScanMember {
  name: string;
  exported: boolean;
  visibility?: "public" | "protected" | "internal" | "private";
  kind?: "class" | "function" | "interface" | "type" | "constant";
  line?: number;
  bases?: string[];
  fields?: ScanField[];
  methods?: ScanMethod[];
  params?: ScanParam[];
  returns?: string;
  tags?: ScanTag[] | ScanClassTag[];
  value?: string;
}

export interface ScanCall {
  from: string;
  to: string;
  line: number;
  how: "call" | "construct" | "inferred" | "dispatch";
}

export interface ScanSelection {
  extensions: string[];
  skip_directory_names: string[];
  skip_directory_prefixes: string[];
  skip_directory_suffixes: string[];
  skip_directories_containing: string[];
  skip_file_globs: string[];
}

export interface UnresolvedImport {
  from: string;
  import: string;
  line: number;
}

export interface Scan {
  modules: {
    id: string;
    kind: "module" | "package" | "interface";
    members?: ScanMember[];
  }[];
  edges: ScanEdge[];
  calls?: ScanCall[];
  unresolved_imports?: UnresolvedImport[];
  foreign: { id: string; name: string }[];
}

export interface RecordedScan extends Scan {
  commit: string | null;
  modified: boolean | null;
  files: { path: string; hash: string }[];
  selection: ScanSelection;
}

export const SCAN_SCHEMA_VERSION: number =
  schema.properties.schema_version.const;

let compiled: ValidateFunction | undefined;

function validator(): ValidateFunction {
  compiled ??= new Ajv2020({ allErrors: true }).compile(schema);

  return compiled;
}

export function validateScan(value: unknown): Scan {
  const validate = validator();

  if (validate(value)) {
    return value as unknown as Scan;
  }

  const messages = (validate.errors ?? []).map(
    (error) => `scan${error.instancePath} ${error.message ?? "is invalid"}`,
  );

  throw new InputError(messages.length > 0 ? messages : ["scan is invalid"]);
}
