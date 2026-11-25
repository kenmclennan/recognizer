import { selection } from "./files.js";
import { SCAN_SCHEMA_VERSION } from "./scan-schema.js";
import { scannerVersion } from "./version.js";

export const PROTOCOL = 3;

export const INSTALL =
  "brew upgrade kenmclennan/tap/recognizer-scan-typescript || brew install kenmclennan/tap/recognizer-scan-typescript";

const VOCABULARY = {
  comment_markers: ["comment"],
  literal_types: [
    "string",
    "string_fragment",
    "template_string",
    "number",
    "true",
    "false",
    "null",
    "undefined",
    "regex",
  ],
  call_types: ["call_expression"],
  identifier_types: ["identifier"],
  identifier_suffixes: ["_identifier"],
  member_fields: [
    {
      type: "member_expression",
      field: "property",
    },
  ],
  return_types: ["return_statement"],
  assignment_types: ["assignment_expression"],
  member_types: ["member_expression"],
  subscript_types: ["subscript_expression"],
  identifier_leaf_types: ["identifier", "property_identifier"],
  self_types: ["this"],
  self_texts: ["self"],
  plain_name_types: ["identifier"],
  expression_statement_types: ["expression_statement"],
  name_leaf_types: ["identifier", "type_identifier", "property_identifier"],
  binding_declarator_types: ["variable_declarator"],
  binding_name_types: ["identifier"],
  operator_node_types: ["binary_expression"],
  fields: {
    name: "name",
    body: "body",
    parameters: "parameters",
    parameter_pattern: "pattern",
    arguments: "arguments",
    callee: "function",
    operator: "operator",
    assigned_value: "right",
    bound_value: "value",
  },
  assignment_operators: ["="],
};

const GRAMMARS = [
  {
    name: "typescript",
    extensions: [".ts", ".mts", ".cts"],
    function_types: ["function_declaration", "method_definition"],
    scope_types: [
      "class_declaration",
      "abstract_class_declaration",
      "class",
      "internal_module",
      "module",
    ],
    branch_types: [
      "if_statement",
      "for_statement",
      "for_in_statement",
      "while_statement",
      "do_statement",
      "switch_case",
      "catch_clause",
      "ternary_expression",
      "optional_chain",
    ],
    boolean_operators: ["&&", "||", "??"],
    bound_function_types: ["arrow_function", "function_expression", "function"],
    function_names: [],
    vocabulary: VOCABULARY,
  },
  {
    name: "tsx",
    extensions: [".tsx", ".jsx", ".js", ".mjs", ".cjs"],
    function_types: ["function_declaration", "method_definition"],
    scope_types: [
      "class_declaration",
      "abstract_class_declaration",
      "class",
      "internal_module",
      "module",
    ],
    branch_types: [
      "if_statement",
      "for_statement",
      "for_in_statement",
      "while_statement",
      "do_statement",
      "switch_case",
      "catch_clause",
      "ternary_expression",
      "optional_chain",
    ],
    boolean_operators: ["&&", "||", "??"],
    bound_function_types: ["arrow_function", "function_expression", "function"],
    function_names: [],
    vocabulary: VOCABULARY,
  },
];

const TEST_FILES = [
  {
    extensions: [],
    directory_names: ["__tests__", "test", "tests"],
    directory_suffixes: [],
    basename_patterns: [
      "^.*\\.(?:test|spec)\\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$",
    ],
    stem_suffixes: [],
  },
];

export function manifest() {
  const rules = selection();

  return {
    kind: "scanner",
    name: "typescript",
    display: "TypeScript",
    version: scannerVersion(),
    protocol: PROTOCOL,
    install: INSTALL,
    check: false,
    long_running: true,
    units: ["files"],
    settings: [],
    scan_schema_version: SCAN_SCHEMA_VERSION,
    setup_survey: { order: 1 },
    languages: [
      {
        name: "typescript",
        display: "TypeScript",
        grammars: GRAMMARS,
        extensions: rules.extensions,
        files: ["tsconfig.json"],
        test_files: TEST_FILES,
        supertype_links: false,
        private_imports: false,
        skip: {
          directory_names: rules.skip_directory_names,
          directory_prefixes: rules.skip_directory_prefixes,
          directory_suffixes: rules.skip_directory_suffixes,
          directory_markers: rules.skip_directories_containing,
          file_globs: rules.skip_file_globs,
        },
      },
    ],
  };
}

export function manifestText(): string {
  return `${JSON.stringify(manifest(), null, 2)}\n`;
}
