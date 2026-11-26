import type { KeyEntry } from "./published-keys.js";

export type SettingScope = "repository" | "machine";

export type SettingSwitch = { key: string } | { value: true } | { unset: true };

export interface Setting extends KeyEntry {
  label?: string;
  labels?: Record<string, string>;
  unit?: string;
  units?: Record<string, string>;
  order?: number;
  limit?: { metric: string; direction: "above" | "below"; severity?: string };
  section?: string;
  scope?: SettingScope;
  switch?: SettingSwitch;
}

export interface CorePane {
  id: string;
  name: string;
  group: SettingScope;
  settings: Setting[];
}

const WARNINGS = "sensors.structure.warnings";
const DUPLICATION = "sensors.structure.duplication";

function warning(
  name: string,
  label: string,
  fallback: boolean,
  description: string,
): Setting {
  return {
    key: `${WARNINGS}.${name}`,
    type: "boolean",
    default: fallback,
    description,
    example: `${WARNINGS}.${name} ${String(!fallback)}`,
    label,
    section: "Warnings",
  };
}

const STRUCTURE: Setting[] = [
  warning(
    "cycle",
    "Import cycles",
    true,
    "report files that import each other in a loop",
  ),
  warning(
    "orphan",
    "Orphan files",
    true,
    "report files nothing imports and that are not entry points",
  ),
  warning(
    "private_imports",
    "Private imports",
    true,
    "report imports that reach into the private files of another folder",
  ),
  warning(
    "unused_exports",
    "Unused exports",
    false,
    "report exports no other file uses",
  ),
  {
    key: `${WARNINGS}.long_function.limit`,
    type: "integer",
    minimum: 1,
    default: 20,
    description:
      "the most lines a function's body may have before the long function warning reports it",
    example: `${WARNINGS}.long_function.limit 30`,
    label: "Long function",
    unit: "lines",
    section: "Limits",
    switch: { key: `${WARNINGS}.long_function` },
  },
  {
    key: `${WARNINGS}.complexity.limit`,
    type: "integer",
    minimum: 1,
    default: 10,
    description:
      "the most branch paths a function may have before the complexity warning reports it",
    example: `${WARNINGS}.complexity.limit 15`,
    label: "Complexity",
    unit: "paths",
    section: "Limits",
    switch: { key: `${WARNINGS}.complexity` },
  },
  {
    key: `${DUPLICATION}.threshold`,
    type: "number",
    exclusiveMinimum: 0,
    maximum: 1,
    default: 0.82,
    description:
      "the similarity two functions need to count as duplicates, above 0 and at most 1",
    example: `${DUPLICATION}.threshold 0.9`,
    label: "Similarity",
    unit: "0 to 1",
    section: "Duplication",
  },
  {
    key: `${DUPLICATION}.min_lines`,
    type: "integer",
    minimum: 1,
    default: 4,
    description: "the fewest lines a function needs to be compared",
    example: `${DUPLICATION}.min_lines 6`,
    label: "Fewest lines compared",
    unit: "lines",
    section: "Duplication",
  },
  {
    key: `${DUPLICATION}.pair_min_lines`,
    type: "integer",
    minimum: 1,
    default: 6,
    description: "the fewest lines the shorter function of a pair needs",
    example: `${DUPLICATION}.pair_min_lines 8`,
    label: "Shorter of a pair",
    unit: "lines",
    section: "Duplication",
  },
  {
    key: `${DUPLICATION}.min_nodes`,
    type: "integer",
    minimum: 1,
    default: 20,
    description: "the fewest syntax nodes a function needs to be compared",
    example: `${DUPLICATION}.min_nodes 30`,
    label: "Fewest syntax nodes",
    unit: "nodes",
    section: "Duplication",
  },
];

const MACHINE: Setting[] = [
  {
    key: "editor",
    type: "string",
    default_text: "System default",
    scope: "machine",
    label: "Open files in",
    unit: "app or command",
    description:
      "an app name such as Sublime Text, or a command such as code -g {file}:{line}; without {file} and {line} the file opens at the top; terminal editors are not supported",
    example: "editor Sublime Text",
    order: 1,
  },
  {
    key: "describing.batch_size",
    type: "integer",
    minimum: 1,
    maximum: 16,
    default: 4,
    scope: "machine",
    label: "Batch size",
    unit: "files at a time",
    description: "how many files a describe request carries",
    example: "describing.batch_size 8",
    order: 2,
  },
  {
    key: "describing.confirm_above_usd",
    type: "number",
    minimum: 0,
    maximum: 10000,
    default: 5,
    scope: "machine",
    label: "Ask before spending over",
    unit: "USD",
    description:
      "a scan asks before describing when its estimated cost, at API prices, is above this",
    example: "describing.confirm_above_usd 2",
    order: 3,
  },
  {
    key: "setup.model",
    type: "string",
    default: "sonnet",
    scope: "machine",
    label: "Model",
    description:
      "the model Check with Claude runs in the Setup modal; applying the changes it proposes runs no model",
    example: "setup.model sonnet",
    order: 1,
  },
];

export function machineSetting(key: string): Setting {
  const found = MACHINE.find((one) => one.key === key);

  if (found === undefined) {
    throw new Error(`no machine setting ${key}`);
  }

  return found;
}

export const CORE_PANES: CorePane[] = [
  {
    id: "editor",
    name: "Editor",
    group: "machine",
    settings: MACHINE.filter((one) => one.key === "editor"),
  },
  {
    id: "describing",
    name: "Describing",
    group: "machine",
    settings: MACHINE.filter((one) => one.key.startsWith("describing.")),
  },
  {
    id: "setup",
    name: "Setup",
    group: "machine",
    settings: MACHINE.filter((one) => one.key === "setup.model"),
  },
  {
    id: "structure",
    name: "Structural analysis",
    group: "repository",
    settings: STRUCTURE,
  },
];
