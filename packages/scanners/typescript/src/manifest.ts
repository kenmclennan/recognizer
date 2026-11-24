import { selection } from "./files.js";
import { SCAN_SCHEMA_VERSION } from "./scan-schema.js";
import { scannerVersion } from "./version.js";

export const PROTOCOL = 2;

export const INSTALL =
  "brew upgrade kenmclennan/tap/recognizer-scan-typescript || brew install kenmclennan/tap/recognizer-scan-typescript";

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
