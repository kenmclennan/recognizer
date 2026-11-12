import type { KeySchema } from "./config-keys.js";

export const POLICY_KEYS: KeySchema = {
  keys_version: 1,
  owner: "recognizer",
  placeholders: { name: "^[^.\\s]+$" },
  sections: [
    {
      key: "components",
      shape: "map-entry",
      description: "the components, each a name holding its globs",
      example: "--add-section components",
    },
    {
      key: "uses",
      shape: "map-entry",
      description:
        "the dependency rules, each a component holding the components it may depend on",
      example: "--remove-section uses",
    },
    {
      key: "foreign",
      shape: "map-entry",
      description: "the foreign groups, each a name holding its members",
      example: "--remove-section foreign",
    },
  ],
  keys: [
    {
      key: "components.<name>",
      type: "string",
      multi: true,
      description: "the globs of one component",
      example: "--add components.domain src/domain/**",
    },
    {
      key: "levels",
      type: "string",
      multi: true,
      description:
        "component names, outermost first, in the order they are added",
      example: "--add levels domain",
    },
    {
      key: "uses.<name>",
      type: "string",
      multi: true,
      description: "the components that <name> may depend on",
      example: "--add uses.adapters domain",
    },
    {
      key: "forbid",
      type: "string",
      multi: true,
      description: "`<from-glob> -> <to-glob>` strings naming forbidden edges",
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
