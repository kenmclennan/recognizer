import {
  addSection,
  CORE_KEYS,
  comparePlugins,
  type EditOutcome,
  type KeySchema,
  type PaneDescriber,
  type PaneSensor,
  parseKeySchema,
  publish,
  type SettingsPane,
  settingsPanes,
  setValue,
  unsetValue,
} from "recognizer";
import { configHash } from "./config-hash";
import type {
  ConfigKeysResult,
  PanesResult,
  RepositoryEdit,
  Settings,
  SettingsModalPort,
  WriteResult,
} from "./settings-modal-port";

export type { PaneDescriber, PaneSensor };
export { comparePlugins };

export type PaneSources = {
  sensors: PaneSensor[];
  describers: PaneDescriber[];
};

export type FakeSettingsModal = SettingsModalPort & {
  settings: Settings;
  config: string | null;
  keys: ConfigKeysResult;
  panes: PanesResult;
  calls: string[];
  failSettings: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  values: {
    "describing.model": "haiku",
    "describing.batch_size": "4",
    "describing.confirm_above_usd": "5",
    "setup.model": "sonnet",
  },
};

function panesOf(schema: unknown, plugins: PaneSources): PanesResult {
  const schemas: KeySchema[] = [CORE_KEYS];

  if (schema !== undefined) {
    const parsed = parseKeySchema(JSON.stringify(schema));

    if ("schema" in parsed) {
      schemas.push(parsed.schema);
    }
  }

  const panes: SettingsPane[] = settingsPanes({
    sensors: plugins.sensors,
    describers: plugins.describers,
    published: publish(schemas, "config"),
  });

  return { status: "ok", panes };
}

function emptyPlugins(): PaneSources {
  return { sensors: [], describers: [] };
}

export function fakeSettingsModal(
  options: {
    settings?: Settings;
    config?: string | null;
    schema?: unknown;
    plugins?: PaneSources;
  } = {},
): FakeSettingsModal {
  const fake: FakeSettingsModal = {
    settings: options.settings ?? DEFAULT_SETTINGS,
    config: options.config ?? null,
    keys:
      options.schema === undefined
        ? {
            status: "unavailable",
            reason: "recognizer config --schema did not answer",
          }
        : { status: "ok", schema: options.schema },
    panes: panesOf(options.schema, options.plugins ?? emptyPlugins()),
    calls: [],
    failSettings: false,
    async readSettings() {
      fake.calls.push("read_settings");

      return fake.settings;
    },
    async writeSettings(edits) {
      fake.calls.push("write_settings");

      if (fake.failSettings) {
        throw new Error("could not write the settings file");
      }

      const values = { ...fake.settings.values };

      for (const edit of edits) {
        values[edit.key] = String(edit.value);
      }

      fake.settings = { values };
    },
    async readPanes() {
      fake.calls.push("read_panes");

      return fake.panes;
    },
    async readConfigKeys() {
      fake.calls.push("read_config_keys");

      return fake.keys;
    },
    async writeRepositoryConfig(
      edits: RepositoryEdit[],
      baseHash: string,
    ): Promise<WriteResult> {
      fake.calls.push("write_repository_config");

      if ((await configHash(fake.config)) !== baseHash) {
        return {
          status: "changed",
          reason: "the config changed since it was read",
        };
      }

      const schemas: KeySchema[] = [CORE_KEYS];

      if (fake.keys.status === "ok") {
        const parsed = parseKeySchema(JSON.stringify(fake.keys.schema));

        if ("schema" in parsed) {
          schemas.push(parsed.schema);
        }
      }

      const published = publish(schemas, "config");
      let text = fake.config ?? "";

      for (const edit of edits) {
        const outcome: EditOutcome =
          edit.op === "add-section"
            ? addSection(text, published, edit.key)
            : edit.op === "unset"
              ? unsetValue(text, published, edit.key)
              : setValue(text, published, edit.key, edit.value ?? "");

        if (outcome.status === "refused") {
          return { status: "refused", key: edit.key, reason: outcome.reason };
        }

        if (outcome.status === "ok") {
          text = outcome.text;
        }
      }

      fake.config = text;

      return { status: "written", text };
    },
  };

  return fake;
}
