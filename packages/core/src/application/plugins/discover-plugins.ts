import { joinPath } from "../../domain/path.js";
import {
  type Discovery,
  KINDS,
  PREFIXES,
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
import { readManifest, readManifestCommand } from "./read-manifest.js";

function kindOf(fileName: string): PluginKind | null {
  return (
    KINDS.find(
      (kind) =>
        fileName.startsWith(PREFIXES[kind]) &&
        fileName.length > PREFIXES[kind].length,
    ) ?? null
  );
}

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
  const viaPath: PluginKind[] = [];

  for (const kind of kinds) {
    const registered = registeredOfKind(ports, kind);

    if (registered.length === 0) {
      viaPath.push(kind);
    } else {
      discoverRegistered(ports, kind, registered, result);
    }
  }

  if (viaPath.length > 0) {
    const onPath = discoverOnPath(ports, viaPath);

    result.plugins.push(...onPath.plugins);
    result.unreadable.push(...onPath.unreadable);
  }

  return result;
}

function discoverOnPath(
  ports: { programs: Programs; validators: DocumentValidators },
  kinds: readonly PluginKind[],
): Discovery {
  const seen = new Set<string>();
  const found: { kind: PluginKind; fileName: string; command: string }[] = [];
  const listed = ports.programs.listOnPath(kinds.map((kind) => PREFIXES[kind]));

  for (const entry of listed) {
    const kind = kindOf(entry.name);

    if (kind === null || !kinds.includes(kind) || seen.has(entry.name)) {
      continue;
    }

    seen.add(entry.name);
    found.push({
      kind,
      fileName: entry.name,
      command: joinPath(entry.directory, entry.name),
    });
  }

  const result: Discovery = { plugins: [], unreadable: [] };
  const { facts } = ports.validators;

  for (const { kind, fileName, command } of found) {
    const read = readManifest(ports, command);

    if (!read.ok) {
      result.unreadable.push({ command, reason: read.reason });

      continue;
    }

    const { manifest } = read;
    const name = fileName.slice(PREFIXES[kind].length);

    if (manifest.kind !== kind) {
      result.unreadable.push({
        command,
        reason: `${command} manifest kind is ${manifest.kind}, not ${kind}`,
      });
    } else if (manifest.name !== name) {
      result.unreadable.push({
        command,
        reason: `${command} manifest name is ${manifest.name}, not ${name}`,
      });
    } else {
      result.plugins.push({
        kind,
        name,
        command,
        manifest,
        judgement: judgeProtocol(manifest, facts.protocol),
        schema:
          kind === "scanner"
            ? judgeScanSchema(
                manifest.scan_schema_version,
                facts.scanSchemaVersion,
                facts.scanBreakingVersions,
              )
            : "undeclared",
      });
    }
  }

  return result;
}
