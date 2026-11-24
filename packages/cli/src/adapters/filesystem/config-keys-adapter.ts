import type { ConfigKeyEntry, ConfigKeys } from "@recognizer/core";
import { CORE_KEYS } from "../../config-keys.js";

export class ConfigKeysAdapter implements ConfigKeys {
  entries(): ConfigKeyEntry[] {
    return CORE_KEYS.keys.map((entry) => ({
      key: entry.key,
      ...(entry.default === undefined ? {} : { default: entry.default }),
    }));
  }
}
