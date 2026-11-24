export interface ConfigKeyEntry {
  key: string;
  default?: unknown;
}

export interface ConfigKeys {
  entries(): ConfigKeyEntry[];
}
