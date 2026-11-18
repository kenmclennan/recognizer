import type { KeySchema } from "./config-keys.js";

export const POLICY_KEYS: KeySchema = {
  keys_version: 1,
  owner: "recognizer",
  placeholders: {},
  sections: [],
  keys: [
    {
      key: "entry",
      type: "string",
      multi: true,
      description: "paths or globs that are entry points, never orphans",
      example: "--add entry src/main.ts",
    },
    {
      key: "forbid",
      type: "string",
      multi: true,
      description:
        "`<from-glob> -> <to-glob>` strings naming forbidden edges; a rule over lists is written with --add-forbid",
      example: '--add forbid "src/ui/** -> src/db/**"',
    },
    {
      key: "ignore",
      type: "string",
      multi: true,
      description: "globs excluded from the graph",
      example: "--add ignore tests/**",
    },
  ],
};
