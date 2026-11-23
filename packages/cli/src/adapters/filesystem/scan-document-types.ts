export type DocumentTag =
  | "property"
  | "static"
  | "classmethod"
  | "abstract"
  | "async";

export type DocumentClassTag =
  | "dataclass"
  | "frozen"
  | "final"
  | "runtime_checkable"
  | "abstract"
  | "sealed";

export interface DocumentParam {
  name: string;
  type?: string;
}

export interface DocumentField {
  name: string;
  type?: string;
  line: number;
  private: boolean;
}

export interface DocumentMethod {
  name: string;
  line?: number;
  end_line?: number;
  body_line?: number;
  params?: DocumentParam[];
  returns?: string;
  private?: boolean;
  tags?: DocumentTag[];
}

export interface DocumentMember {
  name: string;
  exported: boolean;
  visibility?: "public" | "protected" | "internal" | "private";
  kind?: "class" | "function" | "interface" | "type" | "constant" | "enum";
  line?: number;
  end_line?: number;
  body_line?: number;
  bases?: string[];
  fields?: DocumentField[];
  methods?: DocumentMethod[];
  params?: DocumentParam[];
  returns?: string;
  tags?: DocumentTag[] | DocumentClassTag[];
  value?: string;
}

export interface DocumentEdge {
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

export interface DocumentCall {
  from: string;
  to: string;
  line: number;
  how: "call" | "construct" | "inferred" | "dispatch";
}

export interface DocumentSelection {
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

export interface DocumentModule {
  id: string;
  language: string;
  kind: "module" | "package" | "interface";
  members?: DocumentMember[];
  entry_point?: boolean;
  annotations?: string[];
  actual_of?: string[];
}

export interface ScanDoc {
  scanner: { name: string; version: string };
  commit: string | null;
  modified: boolean | null;
  files: { path: string; hash: string }[];
  selection: DocumentSelection;
  modules: DocumentModule[];
  edges: DocumentEdge[];
  calls?: DocumentCall[];
  unresolved_imports?: { from: string; import: string; line: number }[];
  test_imports?: { from: string; to: string; names?: string[] }[];
  foreign: { id: string; name: string }[];
}
