import type { ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import { InputError } from "./errors.js";
import schema from "./generated/scan.schema.json" with { type: "json" };
import breaking from "./generated/scan-breaking-versions.json" with {
  type: "json",
};

export interface ScanEdge {
  from: string;
  to: string;
  kind: "depends" | "declares" | "inherits" | "implements";
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
  | "abstract"
  | "sealed";

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
  end_line?: number;
  body_line?: number;
  params?: ScanParam[];
  returns?: string;
  private?: boolean;
  tags?: ScanTag[];
}

export interface ScanMember {
  name: string;
  exported: boolean;
  visibility?: "public" | "protected" | "internal" | "private";
  kind?: "class" | "function" | "interface" | "type" | "constant" | "enum";
  line?: number;
  end_line?: number;
  body_line?: number;
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
  skip_paths?: string[];
  input_file_globs?: string[];
  input_absent_paths?: string[];
}

export interface UnresolvedImport {
  from: string;
  import: string;
  line: number;
}

export interface TestImport {
  from: string;
  to: string;
  names?: string[];
}

export interface Scan {
  modules: {
    id: string;
    language: string;
    kind: "module" | "package" | "interface";
    members?: ScanMember[];
    entry_point?: boolean;
    annotations?: string[];
    actual_of?: string[];
  }[];
  edges: ScanEdge[];
  calls?: ScanCall[];
  unresolved_imports?: UnresolvedImport[];
  test_imports?: TestImport[];
  foreign: { id: string; name: string }[];
}

export interface RecordedScan extends Scan {
  scanner: { name: string; version: string };
  commit: string | null;
  modified: boolean | null;
  files: { path: string; hash: string }[];
  selection: ScanSelection;
}

export const SCAN_SCHEMA_VERSION: number =
  schema.properties.schema_version.const;

export const SCAN_BREAKING_VERSIONS: number[] = breaking;

export type ScanVersionVerdict = "current" | "older" | "newer" | "broken";

export function judgeScanVersion(
  found: number,
  current: number = SCAN_SCHEMA_VERSION,
  breaks: readonly number[] = SCAN_BREAKING_VERSIONS,
): ScanVersionVerdict {
  if (found === current) {
    return "current";
  }

  if (found > current) {
    return "newer";
  }

  return breaks.some((b) => found < b && b <= current) ? "broken" : "older";
}

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

export function validateAcceptedScan(
  value: unknown,
  current: number = SCAN_SCHEMA_VERSION,
  breaks: readonly number[] = SCAN_BREAKING_VERSIONS,
): Scan {
  const version = (value as { schema_version?: unknown } | null)
    ?.schema_version;

  if (typeof version !== "number" || !Number.isInteger(version)) {
    return validateScan(value);
  }

  const verdict = judgeScanVersion(version, current, breaks);

  if (verdict === "newer" || verdict === "broken") {
    throw new InputError([
      `scan has schema_version ${version}, recognizer accepts ${current}`,
    ]);
  }

  if (verdict === "current") {
    return validateScan(value);
  }

  validateScan({ ...(value as object), schema_version: SCAN_SCHEMA_VERSION });

  return value as unknown as Scan;
}
