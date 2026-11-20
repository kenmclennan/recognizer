export const GRAMMAR_NAMES = [
  "python",
  "typescript",
  "tsx",
  "kotlin",
  "rust",
  "csharp",
] as const;

export type Grammar = (typeof GRAMMAR_NAMES)[number];

export const EXTENSION_GRAMMARS: Readonly<Record<string, Grammar>> = {
  ".py": "python",
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".jsx": "tsx",
  ".js": "tsx",
  ".mjs": "tsx",
  ".cjs": "tsx",
  ".kt": "kotlin",
  ".rs": "rust",
  ".cs": "csharp",
};

export const LANGUAGE_GRAMMARS: Readonly<Record<string, readonly Grammar[]>> = {
  python: ["python"],
  typescript: ["typescript", "tsx"],
  kotlin: ["kotlin"],
  rust: ["rust"],
  csharp: ["csharp"],
};

export function grammarFor(path: string): Grammar | null {
  const dot = path.lastIndexOf(".");

  if (dot === -1) {
    return null;
  }

  return EXTENSION_GRAMMARS[path.slice(dot).toLowerCase()] ?? null;
}
