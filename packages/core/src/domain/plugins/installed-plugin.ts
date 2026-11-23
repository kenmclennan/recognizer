import {
  type Manifest,
  type PluginKind,
  type ProtocolJudgement,
  type ScanSchemaJudgement,
  supportedRange,
} from "./manifest.js";

export const PREFIXES: Record<PluginKind, string> = {
  scanner: "recognizer-scan-",
  sensor: "recognizer-sense-",
  describer: "recognizer-describe-",
};

export const KINDS: PluginKind[] = ["scanner", "sensor", "describer"];

export interface InstalledPlugin {
  kind: PluginKind;
  name: string;
  command: string;
  manifest: Manifest;
  judgement: ProtocolJudgement;
  schema: ScanSchemaJudgement;
}

export interface UnreadablePlugin {
  command: string;
  reason: string;
}

export interface Discovery {
  plugins: InstalledPlugin[];
  unreadable: UnreadablePlugin[];
}

export function programName(kind: PluginKind, name: string): string {
  return `${PREFIXES[kind]}${name}`;
}

export const CASK_UPGRADE = "brew upgrade --cask kenmclennan/tap/recognizer";

export function unsupportedMessage(
  plugin: { kind: PluginKind; name: string; manifest: Manifest },
  current: number,
  install: string = plugin.manifest.install,
): string {
  return `${programName(plugin.kind, plugin.name)} speaks protocol ${plugin.manifest.protocol} and recognizer supports ${supportedRange(current)}: install ${install}`;
}

export function scanSchemaMessage(
  plugin: {
    kind: PluginKind;
    name: string;
    manifest: Manifest;
    schema: ScanSchemaJudgement;
  },
  facts: { scanSchemaVersion: number; scanBreakingVersions: readonly number[] },
  install: string = plugin.manifest.install,
): string | null {
  const program = programName(plugin.kind, plugin.name);
  const declared = plugin.manifest.scan_schema_version;
  const current = facts.scanSchemaVersion;

  if (plugin.schema === "newer") {
    return `${program} writes scan schema ${declared} and this recognizer reads ${current}: run ${CASK_UPGRADE}`;
  }

  if (plugin.schema === "broken") {
    const at = Math.min(
      ...facts.scanBreakingVersions.filter(
        (b) => (declared ?? 0) < b && b <= current,
      ),
    );

    return `${program} writes scan schema ${declared} and this recognizer cannot read it, because a change at or after ${at} broke older scans: ${install}`;
  }

  return null;
}
