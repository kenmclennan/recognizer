import {
  findKey,
  listKeys,
  type PublishedKey,
  type PublishedKeys,
  type Setting,
  type SettingsPane,
  typedValue,
} from "recognizer";
import type { RepositoryEdit, SettingEdit } from "./settings-modal-port";

export type { SettingsPane };

type Scalar = string | number | boolean;

export type DefaultShown =
  | { kind: "figure"; text: string }
  | { kind: "text"; text: string }
  | { kind: "none" };

type Default = { figure: Scalar } | { text: string } | null;

export type SuiteRow = { key: string; label: string; setting: Setting };

export type SettingsModelInput = {
  panes: readonly SettingsPane[];
  published: PublishedKeys;
  configText: string | null;
  machine: Record<string, string>;
  repository: boolean;
};

export type SettingsModel = {
  panes(): SettingsPane[];
  paneName(id: string): string;
  paneOfKey(key: string): string | null;
  value(key: string): string | null;
  shown(field: Setting): string;
  entryOf(key: string): Setting | PublishedKey | null;
  defaultShown(key: string): DefaultShown;
  resetTitle(field: Setting): string;
  isMachine(key: string): boolean;
  isOn(field: Setting): boolean;
  hasSwitch(field: Setting): boolean;
  toggle(field: Setting): void;
  changed(field: Setting): boolean;
  dirtyField(field: Setting): boolean;
  paneChanged(id: string): boolean;
  stage(key: string, raw: string): void;
  resetField(field: Setting): void;
  addSuite(name: string): string | null;
  suites(): string[];
  suiteRows(name: string): SuiteRow[];
  suiteValue(name: string, suffix: string): string;
  error(key: string): string | null;
  firstError(): { key: string; reason: string } | null;
  refuse(key: string, reason: string): void;
  hasErrors(): boolean;
  edits(): RepositoryEdit[];
  machineEdits(): SettingEdit[];
  count(): number;
  dirty(): boolean;
  repositoryDirty(): boolean;
  machineDirty(): boolean;
};

const PLACEHOLDER = /<([a-z][a-z0-9_]*)>/g;

function defaultOf(entry: Setting | PublishedKey, typed: string[]): Default {
  if (entry.default !== undefined) {
    return { figure: entry.default };
  }

  if (entry.defaults !== undefined && "segments" in entry) {
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

function templateMatch(
  template: string,
  key: string,
): Record<string, string> | null {
  const names: string[] = [];
  const pattern = template
    .split(".")
    .map((part) => {
      const found = /^<([a-z][a-z0-9_]*)>$/.exec(part);

      if (found === null) {
        return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }

      names.push(found[1] as string);

      return "([^.]+)";
    })
    .join("\\.");
  const matched = new RegExp(`^${pattern}$`).exec(key);

  if (matched === null) {
    return null;
  }

  return Object.fromEntries(names.map((name, at) => [name, matched[at + 1]]));
}

export function createSettingsModel(input: SettingsModelInput): SettingsModel {
  const { published } = input;
  const all = input.panes.filter(
    (pane) => input.repository || pane.group === "machine",
  );
  const fields = all.flatMap((pane) =>
    pane.sections.flatMap((section) => section.settings),
  );
  const suiteTemplates = all.flatMap((pane) => pane.suites?.keys ?? []);
  const machineKeys = new Set(
    fields.filter((one) => one.scope === "machine").map((one) => one.key),
  );
  const current = new Map<string, string>();

  for (const line of listKeys(input.configText ?? "", published).lines) {
    const at = line.indexOf("=");

    if (at > 0) {
      current.set(line.slice(0, at), line.slice(at + 1));
    }
  }

  const loadedMachine = new Map(Object.entries(input.machine));
  const staged = new Map<string, string | null>();
  const machineStaged = new Map<string, string>();
  const errors = new Map<string, string>();
  const added: string[] = [];
  const knownSuites = suiteNames(current.keys());
  const remembered = new Map<string, string>();
  const pendingOn = new Set<string>();

  const isMachine = (key: string): boolean => machineKeys.has(key);

  const entryOf = (key: string): Setting | PublishedKey | null => {
    const field = fields.find((one) => one.key === key);

    if (field !== undefined && isMachine(key)) {
      return field;
    }

    const found = findKey(published, key.split("."));

    if ("found" in found) {
      return found.found;
    }

    return field ?? null;
  };

  const defaultFor = (key: string): Default => {
    const entry = entryOf(key);

    return entry === null ? null : defaultOf(entry, key.split("."));
  };

  const machineDefault = (key: string): string => {
    const base = defaultFor(key);

    return base !== null && "figure" in base ? String(base.figure) : "";
  };

  const machineValue = (key: string): string =>
    machineStaged.get(key) ?? loadedMachine.get(key) ?? machineDefault(key);

  const present = (key: string): boolean =>
    staged.has(key) ? staged.get(key) !== null : current.has(key);

  const repositoryValue = (key: string): string | null =>
    staged.has(key)
      ? (staged.get(key) as string | null)
      : (current.get(key) ?? null);

  const value = (key: string): string | null =>
    isMachine(key) ? machineValue(key) : repositoryValue(key);

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

  const sameMachine = (key: string, raw: string): boolean => {
    const base = loadedMachine.get(key) ?? machineDefault(key);
    const entry = entryOf(key);

    if (entry?.type === "integer" || entry?.type === "number") {
      return raw.trim() !== "" && Number(raw) === Number(base);
    }

    return raw === base;
  };

  const stageMachine = (key: string, raw: string): void => {
    errors.delete(key);

    const entry = entryOf(key);
    const blankOk =
      entry !== null &&
      entry.type === "string" &&
      entry.default === undefined &&
      entry.default_text !== undefined;
    const text = blankOk ? raw.trim() : raw;

    if (entry !== null && !(blankOk && text === "")) {
      const typed = typedValue(entry, raw);

      if ("reason" in typed) {
        errors.set(key, typed.reason);
        machineStaged.set(key, raw);

        return;
      }
    }

    if (sameMachine(key, text)) {
      machineStaged.delete(key);
    } else {
      machineStaged.set(key, text);
    }
  };

  const stageRepository = (key: string, raw: string): void => {
    errors.delete(key);

    const entry = entryOf(key);
    const blank = raw.trim() === "";

    if (entry !== null && blank) {
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

  const stage = (key: string, raw: string): void =>
    isMachine(key) ? stageMachine(key, raw) : stageRepository(key, raw);

  const switchKind = (field: Setting): "key" | "value" | "unset" | null => {
    const gate = field.switch;

    if (gate === undefined) {
      return null;
    }

    return "key" in gate ? "key" : "value" in gate ? "value" : "unset";
  };

  const switchKey = (field: Setting): string | null =>
    field.switch !== undefined && "key" in field.switch
      ? field.switch.key
      : null;

  const keysOf = (field: Setting): string[] =>
    [field.key, switchKey(field)].filter((one): one is string => one !== null);

  const booleanOn = (key: string): boolean => {
    const raw = repositoryValue(key);

    if (raw !== null) {
      return raw === "true";
    }

    const base = defaultFor(key);

    return base === null || !("figure" in base) || base.figure === true;
  };

  const isOn = (field: Setting): boolean => {
    const kind = switchKind(field);

    if (kind === "key") {
      return booleanOn(switchKey(field) as string);
    }

    if (kind === "value") {
      return repositoryValue(field.key) !== "false";
    }

    if (kind === "unset") {
      return present(field.key) || pendingOn.has(field.key);
    }

    return true;
  };

  const numberOf = (field: Setting): string => {
    const raw = repositoryValue(field.key);

    if (raw !== null && raw !== "false") {
      return raw;
    }

    const kept = remembered.get(field.key);

    if (kept !== undefined) {
      return kept;
    }

    const base = defaultFor(field.key);

    return base !== null && "figure" in base ? String(base.figure) : "";
  };

  const shown = (field: Setting): string => {
    if (isMachine(field.key)) {
      return machineValue(field.key);
    }

    if (switchKind(field) !== null) {
      return numberOf(field);
    }

    const raw = repositoryValue(field.key);

    if (raw !== null) {
      return raw;
    }

    const base = defaultFor(field.key);

    return base !== null && "figure" in base ? String(base.figure) : "";
  };

  const toggle = (field: Setting): void => {
    const kind = switchKind(field);
    const on = isOn(field);

    if (kind === "key") {
      stageRepository(switchKey(field) as string, on ? "false" : "true");

      return;
    }

    const raw = repositoryValue(field.key);

    if (on && raw !== null && raw !== "false") {
      remembered.set(field.key, raw);
    }

    if (kind === "value") {
      if (on) {
        stageRepository(field.key, "false");
      } else {
        stageRepository(field.key, numberOf(field));
      }

      return;
    }

    if (kind === "unset") {
      if (on) {
        pendingOn.delete(field.key);
        stageValue(field.key, null);
      } else {
        const back = numberOf(field);

        pendingOn.add(field.key);

        if (back !== "") {
          stageRepository(field.key, back);
        }
      }
    }
  };

  const figureChanged = (key: string): boolean => {
    if (isMachine(key)) {
      const base = machineDefault(key);
      const entry = entryOf(key);
      const now = machineValue(key);

      if (entry?.type === "integer" || entry?.type === "number") {
        return Number(now) !== Number(base);
      }

      return now !== base;
    }

    const given = repositoryValue(key);

    if (given === null) {
      return false;
    }

    const base = defaultFor(key);

    return base === null || "text" in base || !sameFigure(given, base.figure);
  };

  const changed = (field: Setting): boolean => {
    if (field.type === "boolean" && switchKind(field) === null) {
      return false;
    }

    return keysOf(field).some((key) => figureChanged(key));
  };

  const dirtyKey = (key: string): boolean =>
    isMachine(key) ? machineStaged.has(key) : staged.has(key);

  const paneFields = (id: string): Setting[] =>
    all
      .filter((pane) => pane.id === id)
      .flatMap((pane) => pane.sections.flatMap((one) => one.settings));

  const suitePrefixKeys = (name: string): string[] => {
    const prefix = `tests.${name}.`;

    return [...new Set([...current.keys(), ...staged.keys()])]
      .filter((key) => key.startsWith(prefix))
      .sort();
  };

  const optionsFor = (setting: Setting, name: string): Setting | null => {
    const by = setting.choices_by;

    if (by === undefined) {
      return setting;
    }

    const value = repositoryValue(by.key.replace(PLACEHOLDER, name));
    const choices = value === null ? undefined : by.choices[value];

    if (choices === undefined) {
      return setting;
    }

    return choices.length === 0 ? null : { ...setting, values: choices };
  };

  const suiteRows = (name: string): SuiteRow[] =>
    suiteTemplates.flatMap((setting): SuiteRow[] => {
      const names = [...setting.key.matchAll(PLACEHOLDER)].map(
        (found) => found[1] as string,
      );

      if (names.length === 1) {
        const offered = optionsFor(setting, name);

        return offered === null
          ? []
          : [
              {
                key: setting.key.replace(PLACEHOLDER, name),
                label: setting.label ?? setting.key,
                setting: offered,
              },
            ];
      }

      return suitePrefixKeys(name).flatMap((key) => {
        const matched = templateMatch(setting.key, key);

        return matched === null || matched.name !== name
          ? []
          : [
              {
                key,
                label: Object.entries(matched)
                  .filter(([one]) => one !== "name")
                  .map(([, text]) => text)
                  .join(" "),
                setting,
              },
            ];
      });
    });

  const unitsChanged = (): number => {
    const seen = new Set<string>();

    for (const field of fields) {
      if (keysOf(field).some(dirtyKey)) {
        seen.add(field.key);
      }
    }

    let total = seen.size;

    for (const key of staged.keys()) {
      if (key.startsWith("tests.")) {
        total += 1;
      }
    }

    return total + added.length;
  };

  return {
    panes: () => [...all],
    paneName: (id) => all.find((pane) => pane.id === id)?.name ?? id,
    paneOfKey(key) {
      if (key.startsWith("tests.")) {
        return all.find((pane) => pane.suites !== undefined)?.id ?? null;
      }

      return (
        all.find((pane) =>
          pane.sections.some((section) =>
            section.settings.some((one) => keysOf(one).includes(key)),
          ),
        )?.id ?? null
      );
    },
    value,
    shown,
    entryOf,
    resetTitle(field) {
      const kind = switchKind(field);
      const base = defaultFor(field.key);

      if (base === null) {
        return kind === "unset" ? "Reset to off" : "Reset";
      }

      if ("text" in base) {
        return `Reset to ${base.text}`;
      }

      if (kind === "value" && base.figure === false) {
        return "Reset to off";
      }

      const unit = field.unit === undefined ? "" : ` ${field.unit}`;

      return `Reset to ${figureText(base.figure)}${typeof base.figure === "boolean" ? "" : unit}`;
    },
    defaultShown(key) {
      const base = defaultFor(key);

      if (base === null) {
        return { kind: "none" };
      }

      return "text" in base
        ? { kind: "text", text: base.text }
        : { kind: "figure", text: figureText(base.figure) };
    },
    isMachine,
    isOn,
    hasSwitch: (field) => switchKind(field) !== null,
    toggle,
    changed,
    dirtyField: (field) => keysOf(field).some(dirtyKey),
    paneChanged(id) {
      if (all.some((pane) => pane.id === id && pane.suites !== undefined)) {
        return (
          added.length > 0 ||
          [...staged.keys()].some((key) => key.startsWith("tests."))
        );
      }

      return paneFields(id).some((field) => keysOf(field).some(dirtyKey));
    },
    stage,
    resetField(field) {
      for (const key of keysOf(field)) {
        errors.delete(key);

        if (isMachine(key)) {
          stageMachine(key, machineDefault(key));
        } else {
          stageValue(key, null);
        }
      }

      pendingOn.delete(field.key);
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
    suiteRows,
    suiteValue(name, suffix) {
      return repositoryValue(`tests.${name}.${suffix}`) ?? "";
    },
    error: (key) => errors.get(key) ?? null,
    firstError() {
      const first = errors.entries().next();

      return first.done === true
        ? null
        : { key: first.value[0], reason: first.value[1] };
    },
    refuse(key, reason) {
      errors.set(key, reason);
    },
    hasErrors: () => errors.size > 0,
    edits() {
      const out: RepositoryEdit[] = [];
      const offKeys = new Set(
        fields
          .filter(
            (field) =>
              switchKey(field) !== null &&
              staged.get(switchKey(field) as string) === "false",
          )
          .map((field) => field.key),
      );

      for (const name of added) {
        const live = suitePrefixKeys(name).filter(
          (key) => staged.get(key) !== null,
        );

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

        if (offKeys.has(key)) {
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
    machineEdits() {
      return [...machineStaged].map(([key, raw]): SettingEdit => {
        const entry = entryOf(key);
        const typed = entry === null ? { value: raw } : typedValue(entry, raw);

        return { key, value: "value" in typed ? typed.value : raw };
      });
    },
    count: unitsChanged,
    dirty: () => staged.size > 0 || added.length > 0 || machineStaged.size > 0,
    repositoryDirty: () => staged.size > 0 || added.length > 0,
    machineDirty: () => machineStaged.size > 0,
  };
}
