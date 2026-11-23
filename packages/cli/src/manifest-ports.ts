import { DocumentValidatorsAdapter } from "./adapters/plugins/document-validators-adapter.js";
import { ProgramsAdapter } from "./adapters/plugins/programs-adapter.js";
import { shippedPlugins } from "./adapters/plugins/shipped-plugins-adapter.js";
import type { Io } from "./cli.js";

export const documentValidators = new DocumentValidatorsAdapter();

export function manifestPorts(io: Io): {
  programs: ProgramsAdapter;
  validators: DocumentValidatorsAdapter;
} {
  return { programs: new ProgramsAdapter(io), validators: documentValidators };
}

export function shippedPorts(io: Io) {
  return { ...manifestPorts(io), shipped: shippedPlugins() };
}
