import type { Language } from "./language.js";

export interface ExtractionSelection {
  readonly extensions: readonly string[];
  readonly skipDirectoryNames: readonly string[];
  readonly skipDirectoryPrefixes: readonly string[];
  readonly skipDirectorySuffixes: readonly string[];
  readonly skipDirectoriesContaining: readonly string[];
  readonly skipFileGlobs: readonly string[];
  readonly skipPaths?: readonly string[];
  readonly inputFileGlobs?: readonly string[];
  readonly inputAbsentPaths?: readonly string[];
}

export type OptionalSection = "calls" | "unresolved_imports" | "test_imports";

export interface Extraction {
  readonly language: Language;
  readonly scanner: { readonly name: string; readonly version: string };
  readonly commit: string | null;
  readonly modified: boolean | null;
  readonly selection: ExtractionSelection;
  readonly files: readonly { readonly path: string; readonly hash: string }[];
  readonly sections?: readonly OptionalSection[];
}
