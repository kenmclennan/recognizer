import {
  addSection,
  CORE_KEYS,
  type EditOutcome,
  type KeySchema,
  parseKeySchema,
  publish,
  setValue,
  unsetValue,
} from "recognizer";
import { configHash } from "./config-hash";
import type {
  ConfigKeysResult,
  RepositoryEdit,
  Settings,
  SettingsModalPort,
  WriteResult,
} from "./settings-modal-port";

export type FakeSettingsModal = SettingsModalPort & {
  settings: Settings;
  config: string | null;
  keys: ConfigKeysResult;
  calls: string[];
  failSettings: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  editor: "",
  describing: { model: "haiku", batchSize: 4, confirmAboveUsd: 5 },
  setup: { model: "sonnet" },
};

export function fakeSettingsModal(
  options: {
    settings?: Settings;
    config?: string | null;
    schema?: unknown;
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
    calls: [],
    failSettings: false,
    async readSettings() {
      fake.calls.push("read_settings");

      return fake.settings;
    },
    async writeSettings(settings) {
      fake.calls.push("write_settings");

      if (fake.failSettings) {
        throw new Error("could not write the settings file");
      }

      fake.settings = settings;
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
