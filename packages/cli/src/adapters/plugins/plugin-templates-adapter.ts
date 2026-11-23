import type { PluginTemplates } from "@recognizer/core";
import templates from "../../generated/templates.json" with { type: "json" };

export class PluginTemplatesAdapter implements PluginTemplates {
  bundled(): Record<string, string> {
    return templates as Record<string, string>;
  }
}
