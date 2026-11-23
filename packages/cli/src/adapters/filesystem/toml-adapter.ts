import type { Toml } from "@recognizer/core";
import { parse } from "smol-toml";

export class TomlAdapter implements Toml {
  parse(text: string): Record<string, unknown> | null {
    try {
      return parse(text) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}
