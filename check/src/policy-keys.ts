import type { KeySchema } from "./config-keys.js";

export const POLICY_KEYS: KeySchema = {
  keys_version: 1,
  owner: "recognizer",
  placeholders: { name: "^[^.\\s]+$" },
  sections: [
    {
      key: "foreign",
      shape: "map-entry",
      description: "the foreign groups, each a name holding its members",
      example: "--remove-section foreign",
    },
  ],
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
      key: "foreign.<name>",
      type: "string",
      multi: true,
      description: "the members of one foreign group",
      example: "--add foreign.http requests",
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
