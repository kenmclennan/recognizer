import type { FindingsRepository } from "@recognizer/core";
import type { Io } from "../cli.js";
import {
  findingsFile,
  readStoredFindings,
  readStoredOverlays,
} from "../findings-files.js";

export interface PluginTexts {
  findings: string | null;
  overlay: string | null;
  findingsProblem: string | null;
  overlayProblem: string | null;
}

export function readPluginTexts(
  io: Io,
  root: string,
): Record<string, PluginTexts> {
  const plugins: Record<string, PluginTexts> = {};
  const entry = (name: string): PluginTexts => {
    plugins[name] ??= {
      findings: null,
      overlay: null,
      findingsProblem: null,
      overlayProblem: null,
    };

    return plugins[name] as PluginTexts;
  };

  for (const one of readStoredFindings(io, root)) {
    const held = entry(one.name);

    if (one.status === "invalid") {
      held.findingsProblem = one.reason;

      continue;
    }

    try {
      held.findings = io.readFile(findingsFile(root, one.name));
    } catch (error) {
      held.findingsProblem = (error as Error).message;
    }
  }

  for (const one of readStoredOverlays(io, root)) {
    const held = entry(one.name);

    if (one.status === "invalid") {
      held.overlayProblem = one.reason;
    } else {
      held.overlay = one.text;
    }
  }

  return plugins;
}

const PLUGIN_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function clearPlugin(
  findings: FindingsRepository,
  root: string,
  plugin: string,
): void {
  if (!PLUGIN_NAME.test(plugin)) {
    throw new Error(`${plugin} is not a plugin name`);
  }

  findings.remove(root, plugin);
}
