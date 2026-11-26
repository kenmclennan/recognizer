import { InvalidRequest } from "../../domain/invalid-request.js";
import { unsupportedMessage } from "../../domain/plugins/installed-plugin.js";
import {
  judgeProtocol,
  type PluginKind,
} from "../../domain/plugins/manifest.js";
import type { PluginPorts } from "./internal/plugin-ports.js";
import { readManifest } from "./read-manifest.js";

export interface RegisterWithRegistryRequest {
  program: string;
  expected?: { kind?: PluginKind; name?: string };
}

export type RegisterWithRegistryResult =
  | { status: "failed"; message: string }
  | { status: "done"; warnings: string[]; line: string };

type RegisterPorts = Pick<
  PluginPorts,
  "programs" | "validators" | "registrations"
>;

function locate(ports: RegisterPorts, program: string): string {
  if (program.includes("/")) {
    return program;
  }

  const found = ports.programs.find(program);

  if (found === null) {
    throw new InvalidRequest([`${program} was not found on PATH`]);
  }

  return found;
}

export function registerWithRegistry(
  ports: RegisterPorts,
  request: RegisterWithRegistryRequest,
): RegisterWithRegistryResult {
  const path = locate(ports, request.program);
  const read = readManifest(ports, path);

  if (!read.ok) {
    return { status: "failed", message: read.reason };
  }

  const { manifest } = read;
  const { kind, name } = manifest;
  const expected = request.expected;

  if (
    (expected?.kind !== undefined && expected.kind !== kind) ||
    (expected?.name !== undefined && expected.name !== name)
  ) {
    return {
      status: "failed",
      message: `${path} manifest names a ${kind} called ${name}, not the ${expected?.kind ?? kind} ${expected?.name ?? name}`,
    };
  }

  const current = ports.validators.facts.protocol;
  const judgement = judgeProtocol(manifest, current);

  if (judgement === "unsupported") {
    return {
      status: "failed",
      message: unsupportedMessage({ kind, name, manifest }, current),
    };
  }

  if (kind === "describer" && manifest.prompt_version === undefined) {
    return {
      status: "failed",
      message: `${path} manifest has no prompt_version`,
    };
  }

  const outcome = ports.registrations.register({
    kind,
    name,
    command: [path],
    manifest: [path, "manifest"],
    source: "user",
  });

  if (outcome.status === "refused") {
    return { status: "failed", message: outcome.reason };
  }

  return {
    status: "done",
    warnings:
      judgement === "previous"
        ? [
            `${path} speaks the previous protocol ${manifest.protocol}: install ${manifest.install}`,
          ]
        : [],
    line: `registered ${kind} ${name}: ${outcome.path}`,
  };
}

export interface UnregisterRequest {
  name: string;
  kind: PluginKind | undefined;
}

export interface UnregisterResult {
  status: "done" | "failed";
  message: string;
}

export function unregisterFromRegistry(
  ports: Pick<PluginPorts, "registrations">,
  request: UnregisterRequest,
): UnregisterResult {
  const { name } = request;
  const outcome = ports.registrations.unregister(name, request.kind);

  switch (outcome.status) {
    case "removed":
      return {
        status: "done",
        message: `unregistered ${outcome.kind} ${name}`,
      };
    case "homebrew-only":
      return {
        status: "done",
        message: `${outcome.kind} ${name} has only a Homebrew registration: brew uninstall of its formula removes it`,
      };
    case "not-registered":
      return { status: "failed", message: `${name} is not registered` };
    case "ambiguous":
      return {
        status: "failed",
        message: `${name} is registered as more than one kind (${outcome.kinds.join(", ")}): give --kind`,
      };
  }
}
