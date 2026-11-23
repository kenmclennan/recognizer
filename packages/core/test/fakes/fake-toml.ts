import type { Toml } from "../../src/index.js";

export class FakeToml implements Toml {
  readonly parsed = new Map<string, Record<string, unknown>>();

  parse(text: string): Record<string, unknown> | null {
    return this.parsed.get(text) ?? null;
  }
}
