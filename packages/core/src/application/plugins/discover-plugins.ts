import {
  type Discovery,
  KINDS,
} from "../../domain/plugins/installed-plugin.js";
import {
  judgeProtocol,
  judgeScanSchema,
  type PluginKind,
} from "../../domain/plugins/manifest.js";
import type { RegisteredPlugin } from "../../domain/plugins/registration.js";
import type { DocumentValidators } from "./ports/document-validators.js";
import type { PluginRegistrations } from "./ports/plugin-registrations.js";
import type { Programs } from "./ports/programs.js";
import { readManifestCommand } from "./read-manifest.js";

export function registeredOfKind(
  ports: { registrations?: PluginRegistrations },
  kind: PluginKind,
): RegisteredPlugin[] {
  return (ports.registrations?.entries().plugins ?? []).filter(
    (entry) => entry.kind === kind,
  );
}

function discoverRegistered(
  ports: { programs: Programs; validators: DocumentValidators },
  kind: PluginKind,
  registered: readonly RegisteredPlugin[],
  result: Discovery,
): void {
  const { facts } = ports.validators;

  for (const entry of registered) {
    const command = entry.command.join(" ");
    const read = readManifestCommand(ports, entry.manifest);

    if (!read.ok) {
      result.unreadable.push({ command, reason: read.reason });
    } else if (read.manifest.kind !== kind) {
      result.unreadable.push({
        command,
        reason: `${command} manifest kind is ${read.manifest.kind}, not ${kind}`,
      });
    } else if (read.manifest.name !== entry.name) {
      result.unreadable.push({
        command,
        reason: `${command} manifest name is ${read.manifest.name}, not ${entry.name}`,
      });
    } else {
      result.plugins.push({
        kind,
        name: entry.name,
        command,
        manifest: read.manifest,
        judgement: judgeProtocol(read.manifest, facts.protocol),
        schema:
          kind === "scanner"
            ? judgeScanSchema(
                read.manifest.scan_schema_version,
                facts.scanSchemaVersion,
                facts.scanBreakingVersions,
              )
            : "undeclared",
      });
    }
  }
}

export function discoverPlugins(
  ports: {
    programs: Programs;
    validators: DocumentValidators;
    registrations?: PluginRegistrations;
  },
  kinds: readonly PluginKind[] = KINDS,
): Discovery {
  const result: Discovery = { plugins: [], unreadable: [] };

  for (const kind of kinds) {
    discoverRegistered(ports, kind, registeredOfKind(ports, kind), result);
  }

  return result;
}
