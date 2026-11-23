import type { PluginTemplates } from "../../src/index.js";

export class FakePluginTemplates implements PluginTemplates {
  templates: Record<string, string> = {};

  bundled(): Record<string, string> {
    return this.templates;
  }
}
