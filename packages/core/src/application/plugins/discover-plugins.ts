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
import type { DocumentValidators } from "./ports/document-validators.js";
import type { Programs } from "./ports/programs.js";
import { readManifest } from "./read-manifest.js";

function kindOf(fileName: string): PluginKind | null {
  return (
    KINDS.find(
      (kind) =>
        fileName.startsWith(PREFIXES[kind]) &&
        fileName.length > PREFIXES[kind].length,
    ) ?? null
  );
}

export function discoverPlugins(
  ports: { programs: Programs; validators: DocumentValidators },
  kinds: readonly PluginKind[] = KINDS,
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
