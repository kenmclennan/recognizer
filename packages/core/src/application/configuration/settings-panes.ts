import {
  CORE_PANES,
  type Setting,
} from "../../domain/configuration/core-settings.js";
import {
  findKey,
  type PublishedKeys,
} from "../../domain/configuration/published-keys.js";
import { comparePlugins } from "../../domain/plugin-order.js";

export type PaneGroup = "machine" | "repository";

export interface PaneSection {
  title: string | null;
  settings: Setting[];
}

export interface SettingsPane {
  id: string;
  name: string;
  group: PaneGroup;
  core: boolean;
  sections: PaneSection[];
  suites?: { keys: Setting[] };
}

export interface PaneSensor {
  name: string;
  display: string;
  settings_title?: string;
  runs_tests: boolean;
  suite_keys?: { section: unknown; keys: unknown[] };
  settings: unknown[];
}

export interface PaneDescriber {
  name: string;
  display: string;
  settings_title?: string;
  settings: unknown[];
}

export interface PaneSources {
  sensors: readonly PaneSensor[];
  describers: readonly PaneDescriber[];
  published: PublishedKeys;
}

const PLACEHOLDER = /<[a-z][a-z0-9_]*>/;

const DESCRIBING = "describing";

function known(published: PublishedKeys, key: string): boolean {
  return (
    published.keys.some((entry) => entry.key === key) ||
    "found" in findKey(published, key.split("."))
  );
}

function ordered(settings: readonly Setting[]): Setting[] {
  return settings
    .map((setting, at) => ({ setting, at }))
    .sort(
      (a, b) =>
        (a.setting.order ?? Number.POSITIVE_INFINITY) -
          (b.setting.order ?? Number.POSITIVE_INFINITY) || a.at - b.at,
    )
    .map(({ setting }) => setting);
}

function expanded(setting: Setting, absolute: (key: string) => string) {
  const names: [string | null, string][] =
    setting.labels !== undefined
      ? Object.entries(setting.labels)
      : setting.label !== undefined
        ? [[null, setting.label]]
        : [];

  return names.map(([value, label]): Setting => {
    const { labels, units, defaults, limit, switch: gate, ...rest } = setting;
    const key = (relative: string) =>
      absolute(
        value === null ? relative : relative.replace(PLACEHOLDER, value),
      );
    const unit = value === null ? setting.unit : units?.[value];
    const fallback = value === null ? undefined : defaults?.[value];

    return {
      ...rest,
      ...(fallback === undefined ? {} : { default: fallback }),
      key: key(setting.key),
      label,
      ...(unit === undefined ? {} : { unit }),
      ...(limit?.severity === undefined
        ? {}
        : { limit: { ...limit, severity: key(limit.severity) } }),
      ...(gate !== undefined && "key" in gate
        ? { switch: { key: absolute(gate.key) } }
        : gate === undefined
          ? {}
          : { switch: gate }),
    };
  });
}

function sectionsOf(settings: readonly Setting[]): PaneSection[] {
  const found: PaneSection[] = [];

  for (const setting of settings) {
    const title = setting.section ?? null;
    let at = found.find((one) => one.title === title);

    if (at === undefined) {
      at = { title, settings: [] };
      found.push(at);
    }

    at.settings.push(setting);
  }

  return [
    ...found.filter((one) => one.title === null),
    ...found.filter((one) => one.title !== null),
  ];
}

function pluginFields(
  settings: readonly unknown[],
  repository: (key: string) => string,
  machine: (key: string) => string,
  published: PublishedKeys,
): { repository: Setting[]; machine: Setting[] } {
  const out = { repository: [] as Setting[], machine: [] as Setting[] };

  for (const setting of ordered(settings as Setting[])) {
    if (setting.scope === "machine") {
      out.machine.push(...expanded(setting, machine));
    } else {
      out.repository.push(
        ...expanded(setting, repository).filter((field) =>
          known(published, field.key),
        ),
      );
    }
  }

  return out;
}

function stripped(setting: Setting): Setting {
  const { scope, ...rest } = setting;

  return { ...rest, scope: scope ?? "repository" };
}

function withScope(settings: Setting[]): Setting[] {
  return settings.map(stripped);
}

export function settingsPanes(sources: PaneSources): SettingsPane[] {
  const { published } = sources;
  const machinePanes: SettingsPane[] = [];
  const repositoryPanes: SettingsPane[] = [];
  const pluginRepository: SettingsPane[] = [];
  const suitePanes: SettingsPane[] = [];
  const addedToDescribing: Setting[] = [];

  const plugins = [
    ...sources.describers.map((one) => ({ ...one, sensor: false })),
    ...sources.sensors.map((one) => ({ ...one, sensor: true })),
  ].sort(comparePlugins);

  for (const plugin of plugins) {
    const fields = pluginFields(
      plugin.settings,
      (key) =>
        plugin.sensor ? `sensors.${plugin.name}.${key}` : `describer.${key}`,
      (key) => `${DESCRIBING}.${key}`,
      published,
    );

    addedToDescribing.push(...fields.machine);

    if (fields.repository.length > 0) {
      pluginRepository.push({
        id: plugin.name,
        name: plugin.settings_title ?? plugin.display,
        group: "repository",
        core: false,
        sections: sectionsOf(withScope(fields.repository)),
      });
    }
  }

  for (const core of CORE_PANES) {
    const settings =
      core.id === DESCRIBING
        ? ordered([...core.settings, ...addedToDescribing])
        : core.settings.filter(
            (one) => core.group === "machine" || known(published, one.key),
          );

    if (settings.length === 0) {
      continue;
    }

    (core.group === "machine" ? machinePanes : repositoryPanes).push({
      id: core.id,
      name: core.name,
      group: core.group,
      core: true,
      sections: sectionsOf(withScope(settings)),
    });
  }

  const suiteSensor = sources.sensors.find(
    (one) => one.runs_tests && one.suite_keys !== undefined,
  );

  if (
    suiteSensor !== undefined &&
    published.keys.some((entry) => entry.key === "tests.<name>.directory")
  ) {
    suitePanes.push({
      id: "suites",
      name: "Test suites",
      group: "repository",
      core: true,
      sections: [],
      suites: { keys: (suiteSensor.suite_keys?.keys ?? []) as Setting[] },
    });
  }

  return [
    ...machinePanes,
    ...repositoryPanes,
    ...pluginRepository,
    ...suitePanes,
  ];
}
