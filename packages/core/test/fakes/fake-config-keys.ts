import type { ConfigKeyEntry, ConfigKeys } from "../../src/index.js";

export class FakeConfigKeys implements ConfigKeys {
  held: ConfigKeyEntry[] = [
    { key: "sensors.structure.warnings.long_function.limit", default: 40 },
    { key: "sensors.structure.warnings.complexity.limit", default: 10 },
    { key: "sensors.structure.duplication.pair_min_lines", default: 8 },
  ];

  entries(): ConfigKeyEntry[] {
    return this.held;
  }
}
