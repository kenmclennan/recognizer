import {
  findKey,
  listKeys,
  type PublishedKey,
  type PublishedKeys,
  typedValue,
} from "recognizer";
import type { ShippedSensor, ShippedSetting } from "./sensor-run";
import type { RepositoryEdit } from "./settings-modal-port";

export const MAX_BATCH_SIZE = 16;
export const MAX_CONFIRM_ABOVE_USD = 10000;

export type DescribingValues = {
  model: string;
  batchSize: number;
  confirmAboveUsd: number;
};

export type DescribingCheck =
  | { ok: true; value: DescribingValues }
  | { ok: false; error: string };

export function checkDescribing(
  model: string,
  batchSize: string,
  confirmAbove: string,
): DescribingCheck {
  const name = model.trim();

  if (name === "" || name.startsWith("-") || /\s/.test(name)) {
    return {
      ok: false,
      error:
        "Model must be a name with no spaces and no leading - (for example haiku)",
    };
  }

  const size = Number(batchSize);

  if (
    batchSize.trim() === "" ||
    !Number.isInteger(size) ||
    size < 1 ||
    size > MAX_BATCH_SIZE
  ) {
    return {
      ok: false,
      error: `Batch size must be a whole number from 1 to ${MAX_BATCH_SIZE}`,
    };
  }

  const amount = Number(confirmAbove);

  if (
    confirmAbove.trim() === "" ||
    !Number.isFinite(amount) ||
    amount < 0 ||
    amount > MAX_CONFIRM_ABOVE_USD
  ) {
    return {
      ok: false,
      error: `Ask above must be a number of dollars from 0 to ${MAX_CONFIRM_ABOVE_USD}`,
    };
  }

  return {
    ok: true,
    value: { model: name, batchSize: size, confirmAboveUsd: amount },
  };
}

export type FieldControl = "text" | "number" | "switch" | "limit" | "select";

export type FieldSpec = {
  label: string;
  key: string;
  control: FieldControl;
  unit?: string;
  switchKey?: string;
  severityKey?: string;
};

export type SectionId = string;

export type SectionSpec = {
  id: SectionId;
  name: string;
  fields: FieldSpec[];
};

const WARNINGS = "sensors.structure.warnings";
const DUPLICATION = "sensors.structure.duplication";

export const LONG_FUNCTION_KEY = `${WARNINGS}.long_function`;

const APP_SECTION_SPECS: SectionSpec[] = [
  {
    id: "structure",
    name: "Structure",
    fields: [
      {
        label: "Long function",
        key: `${LONG_FUNCTION_KEY}.limit`,
        control: "limit",
        unit: "lines",
        switchKey: LONG_FUNCTION_KEY,
      },
      { label: "Import cycles", key: `${WARNINGS}.cycle`, control: "switch" },
      {
        label: "Orphan modules",
        key: `${WARNINGS}.orphan`,
        control: "switch",
      },
      {
        label: "Private imports",
        key: `${WARNINGS}.private_imports`,
        control: "switch",
      },
      {
        label: "Unused exports",
        key: `${WARNINGS}.unused_exports`,
        control: "switch",
      },
    ],
  },
  {
    id: "duplication",
    name: "Duplication",
    fields: [
      {
        label: "Similarity",
        key: `${DUPLICATION}.threshold`,
        control: "number",
        unit: "above 0, at most 1",
      },
      {
        label: "Fewest lines compared",
        key: `${DUPLICATION}.min_lines`,
        control: "number",
        unit: "lines",
      },
      {
        label: "Shorter of a pair",
        key: `${DUPLICATION}.pair_min_lines`,
        control: "number",
        unit: "lines",
      },
      {
        label: "Fewest syntax nodes",
        key: `${DUPLICATION}.min_nodes`,
        control: "number",
        unit: "nodes",
      },
    ],
  },
];

export const SUITE_FIELDS = [
  "language",
  "directory",
  "command",
  "activate",
  "runner",
  "coverage.path",
  "coverage.format",
] as const;

export type RepositorySection = { id: SectionId; name: string };

const PLACEHOLDER = /<[a-z][a-z0-9_]*>/;

function expanded(key: string, value: string): string {
  return key.replace(PLACEHOLDER, value);
}

function controlOf(setting: ShippedSetting): FieldControl {
  switch (setting.type) {
    case "boolean":
      return "switch";
    case "number":
    case "integer":
      return "number";
    case "enum":
      return "select";
    default:
      return "text";
  }
}

function fieldsOf(sensor: string, setting: ShippedSetting): FieldSpec[] {
  const names: [string | null, string][] =
    setting.labels !== undefined
      ? Object.entries(setting.labels).map(([value, label]) => [value, label])
      : setting.label !== undefined
        ? [[null, setting.label]]
        : [];

  return names.map(([value, label]) => {
    const full = (key: string) =>
      `sensors.${sensor}.${value === null ? key : expanded(key, value)}`;
    const unit = value === null ? setting.unit : setting.units?.[value];
    const severity = setting.limit?.severity;

    return {
      label,
      key: full(setting.key),
      control: controlOf(setting),
      ...(unit === undefined ? {} : { unit }),
      ...(severity === undefined ? {} : { severityKey: full(severity) }),
    };
  });
}

function sensorSection(sensor: ShippedSensor): SectionSpec | null {
  const ordered = sensor.settings
    .map((setting, at) => ({ setting, at }))
    .sort(
      (a, b) =>
        (a.setting.order ?? Number.POSITIVE_INFINITY) -
          (b.setting.order ?? Number.POSITIVE_INFINITY) || a.at - b.at,
    );
  const fields = ordered.flatMap(({ setting }) =>
    fieldsOf(sensor.name, setting),
  );

  return fields.length === 0
    ? null
    : {
        id: sensor.name,
        name: sensor.settings_title ?? sensor.display,
        fields,
      };
}

export function sectionSpecs(
  shipped: readonly ShippedSensor[],
  published: PublishedKeys,
): SectionSpec[] {
  const has = (key: string) =>
    published.keys.some((entry) => entry.key === key);
  const known = (key: string) =>
    has(key) ||
    has(placeholderKey(key)) ||
    "found" in findKey(published, key.split("."));
  const covered = (spec: SectionSpec) =>
    spec.fields.every((field) => fieldKeys(field).every(known));
  const sensors = shipped
    .map(sensorSection)
    .filter((spec): spec is SectionSpec => spec !== null)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return [...APP_SECTION_SPECS, ...sensors].filter(covered);
}

export function repositorySections(
  shipped: readonly ShippedSensor[],
  published: PublishedKeys,
): RepositorySection[] {
  const found: RepositorySection[] = sectionSpecs(shipped, published).map(
    (spec) => ({ id: spec.id, name: spec.name }),
  );

  if (
    shipped.some((one) => one.runsTests) &&
    published.keys.some((entry) => entry.key === "tests.<name>.directory")
  ) {
    found.push({ id: "suites", name: "Test suites" });
  }

  return found;
}

function placeholderKey(key: string): string {
  return key.replace(
    /^(sensors\.structure\.warnings)\.[a-z_]+$/,
    "$1.<warning>",
  );
}

export type DefaultShown =
  | { kind: "figure"; text: string }
  | { kind: "text"; text: string }
  | { kind: "none" };

type Scalar = string | number | boolean;

function defaultOf(
  entry: PublishedKey,
  typed: string[],
): { figure: Scalar } | { text: string } | null {
  if (entry.default !== undefined) {
    return { figure: entry.default };
  }

  if (entry.defaults !== undefined) {
    const at = entry.segments.findIndex((segment) => "placeholder" in segment);
    const given = entry.defaults[typed[at] as string];

    return given === undefined ? null : { figure: given };
  }

  if (entry.default_text !== undefined) {
    return { text: entry.default_text };
  }

  return null;
}

function sameFigure(raw: string, figure: Scalar): boolean {
  if (typeof figure === "number") {
    return Number(raw) === figure && raw.trim() !== "";
  }

  return raw === String(figure);
}

function figureText(figure: Scalar): string {
  if (typeof figure === "boolean") {
    return figure ? "on" : "off";
  }

  return String(figure);
}

export type RepositoryModel = {
  value(key: string): string | null;
  present(key: string): boolean;
  entryOf(key: string): PublishedKey | null;
  defaultShown(key: string): DefaultShown;
  changed(key: string): boolean;
  fieldChanged(field: FieldSpec): boolean;
  sectionChanged(id: SectionId): boolean;
  stage(key: string, raw: string): void;
  stageSuiteField(key: string, raw: string): void;
  reset(keys: readonly string[]): void;
  resetSection(id: SectionId): void;
  addSuite(name: string): string | null;
  suites(): string[];
  suiteKeys(name: string): string[];
  error(key: string): string | null;
  refuse(key: string, reason: string): void;
  hasErrors(): boolean;
  edits(): RepositoryEdit[];
  dirty(): boolean;
  structureOff(): boolean;
};

function suiteNames(keys: Iterable<string>): string[] {
  const names = new Set<string>();

  for (const key of keys) {
    const match = /^tests\.([^.]+)(\.|$)/.exec(key);

    if (match !== null) {
      names.add(match[1] as string);
    }
  }

  return [...names];
}

export function createRepositoryModel(
  published: PublishedKeys,
  configText: string | null,
  specs: readonly SectionSpec[] = APP_SECTION_SPECS,
): RepositoryModel {
  const current = new Map<string, string>();

  for (const line of listKeys(configText ?? "", published).lines) {
    const at = line.indexOf("=");

    if (at > 0) {
      current.set(line.slice(0, at), line.slice(at + 1));
    }
  }

  const staged = new Map<string, string | null>();
  const errors = new Map<string, string>();
  const added: string[] = [];
  const knownSuites = suiteNames(current.keys());

  const entryOf = (key: string): PublishedKey | null => {
    const found = findKey(published, key.split("."));

    return "found" in found ? found.found : null;
  };

  const present = (key: string): boolean =>
    staged.has(key) ? staged.get(key) !== null : current.has(key);

  const value = (key: string): string | null =>
    staged.has(key)
      ? (staged.get(key) as string | null)
      : (current.get(key) ?? null);

  const defaultFor = (key: string) => {
    const entry = entryOf(key);

    return entry === null ? null : defaultOf(entry, key.split("."));
  };

  const changed = (key: string): boolean => {
    const given = value(key);

    if (given === null) {
      return false;
    }

    const base = defaultFor(key);

    return base === null || "text" in base || !sameFigure(given, base.figure);
  };

  const sectionKeys = (id: SectionId): string[] =>
    specs
      .filter((spec) => spec.id === id)
      .flatMap((spec) => spec.fields.flatMap((field) => fieldKeys(field)));

  const stage = (key: string, raw: string): void => {
    errors.delete(key);

    const entry = entryOf(key);
    const blank = raw.trim() === "";

    if (entry !== null && entry.type !== "string" && blank) {
      stageValue(key, null);

      return;
    }

    if (entry !== null) {
      const typed = typedValue(entry, raw);

      if ("reason" in typed) {
        errors.set(key, typed.reason);
        staged.set(key, raw);

        return;
      }
    }

    const base = defaultFor(key);

    stageValue(
      key,
      base !== null && "figure" in base && sameFigure(raw, base.figure)
        ? null
        : raw,
    );
  };

  const stageValue = (key: string, raw: string | null): void => {
    if (raw === null && !current.has(key)) {
      staged.delete(key);

      return;
    }

    if (raw !== null && current.get(key) === raw) {
      staged.delete(key);

      return;
    }

    staged.set(key, raw);
  };

  const keysOf = (name: string): string[] => {
    const prefix = `tests.${name}.`;
    const live = [...new Set([...current.keys(), ...staged.keys()])].filter(
      (key) => key.startsWith(prefix),
    );

    return [...live].sort();
  };

  return {
    value,
    present,
    entryOf,
    changed,
    defaultShown(key) {
      const base = defaultFor(key);

      if (base === null) {
        return { kind: "none" };
      }

      return "text" in base
        ? { kind: "text", text: base.text }
        : { kind: "figure", text: figureText(base.figure) };
    },
    fieldChanged: (field) => fieldKeys(field).some((key) => changed(key)),
    sectionChanged: (id) =>
      id !== "suites" && sectionKeys(id).some((key) => changed(key)),
    stage,
    stageSuiteField(key, raw) {
      errors.delete(key);

      if (raw === "") {
        stageValue(key, null);

        return;
      }

      const entry = entryOf(key);
      const typed = entry === null ? { value: raw } : typedValue(entry, raw);

      if ("reason" in typed) {
        errors.set(key, typed.reason);
        staged.set(key, raw);

        return;
      }

      stageValue(key, raw);
    },
    reset(keys) {
      for (const key of keys) {
        errors.delete(key);
        stageValue(key, null);
      }
    },
    resetSection(id) {
      for (const key of sectionKeys(id)) {
        if (current.has(key) || staged.has(key)) {
          errors.delete(key);
          stageValue(key, null);
        }
      }
    },
    addSuite(name) {
      if (!/^[A-Za-z0-9_-]+$/.test(name)) {
        return "A suite name is letters, digits, - and _";
      }

      if ([...knownSuites, ...added].includes(name)) {
        return `A suite named ${name} exists`;
      }

      added.push(name);

      return null;
    },
    suites: () => [...knownSuites, ...added],
    suiteKeys: keysOf,
    error: (key) => errors.get(key) ?? null,
    refuse(key, reason) {
      errors.set(key, reason);
    },
    hasErrors: () => errors.size > 0,
    edits() {
      const out: RepositoryEdit[] = [];
      const off = staged.get(LONG_FUNCTION_KEY) === "false";

      for (const name of added) {
        const live = keysOf(name).filter((key) => staged.get(key) !== null);

        out.push({ op: "add-section", key: `tests.${name}` });

        for (const key of live) {
          out.push({ op: "set", key, value: staged.get(key) as string });
        }
      }

      for (const [key, raw] of staged) {
        if (
          key.startsWith("tests.") &&
          added.includes(key.split(".")[1] ?? "")
        ) {
          continue;
        }

        if (off && key === `${LONG_FUNCTION_KEY}.limit`) {
          continue;
        }

        if (raw === null) {
          out.push({ op: "unset", key });
        } else {
          out.push({ op: "set", key, value: raw });
        }
      }

      return out;
    },
    dirty: () => staged.size > 0 || added.length > 0,
    structureOff: () => current.get("sensors.structure") === "off",
  };
}

export function fieldKeys(field: FieldSpec): string[] {
  return [field.key, field.switchKey, field.severityKey].filter(
    (key): key is string => key !== undefined,
  );
}
