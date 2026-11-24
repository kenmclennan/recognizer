import {
  CORE_KEYS,
  type ConfigKeyEntry,
  type ConfigKeys,
} from "@recognizer/core";

export class ConfigKeysAdapter implements ConfigKeys {
  entries(): ConfigKeyEntry[] {
    return CORE_KEYS.keys.map((entry) => ({
      key: entry.key,
      ...(entry.default === undefined ? {} : { default: entry.default }),
    }));
  }
}
