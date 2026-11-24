import type { CheckSandbox } from "../ports/check-sandbox.js";
import type { DocumentValidators } from "../ports/document-validators.js";
import type { PluginRegistry } from "../ports/plugin-registry.js";
import type { PluginTemplates } from "../ports/plugin-templates.js";
import type { Programs } from "../ports/programs.js";
import type { RepositoryChecks } from "../ports/repository-checks.js";

export interface PluginPorts {
  programs: Programs;
  validators: DocumentValidators;
  sandbox: CheckSandbox;
  registry: PluginRegistry;
  templates: PluginTemplates;
  repository: RepositoryChecks;
}
