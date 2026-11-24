import { InvalidRequest } from "../../domain/invalid-request.js";
import {
  programName,
  unsupportedMessage,
} from "../../domain/plugins/installed-plugin.js";
import {
  judgeProtocol,
  type PluginKind,
} from "../../domain/plugins/manifest.js";
import type { PluginPorts } from "./internal/plugin-ports.js";
import { readManifest } from "./read-manifest.js";

export type Registrable = "sensor" | "describer";

export interface RegisterRequest {
  name: string;
  kind: Registrable | undefined;
  root: string;
}

export type RegisterResult =
  | { status: "failed"; message: string }
  | { status: "done"; warnings: string[]; line: string };

type RegisterPorts = Pick<PluginPorts, "programs" | "validators" | "registry">;

function locate(
  ports: RegisterPorts,
  name: string,
  kind: Registrable | undefined,
): { kind: Registrable; program: string; path: string } {
  const kinds: Registrable[] =
    kind === undefined ? ["sensor", "describer"] : [kind];
  const found = kinds.flatMap((one) => {
    const program = programName(one, name);
    const path = ports.programs.find(program);

    return path === null ? [] : [{ kind: one, program, path }];
  });

  if (found.length > 1) {
    throw new InvalidRequest([
      `${name} is both a sensor and a describer: give --kind sensor or --kind describer`,
    ]);
  }

  if (found.length === 1) {
    return found[0] as (typeof found)[number];
  }

  const scanner = programName("scanner", name);

  if (kind === undefined && ports.programs.find(scanner) !== null) {
    throw new InvalidRequest([
      `${name} is a scanner, and scanners are never registered: choose it for a language with recognizer config scanners.<language> ${name}`,
    ]);
  }

  throw new InvalidRequest([
    `${kinds.map((one) => programName(one, name)).join(" or ")} was not found on PATH`,
  ]);
}

export function registerPlugin(
  ports: RegisterPorts,
  request: RegisterRequest,
): RegisterResult {
  const { name } = request;
  const target = locate(ports, name, request.kind);
  const read = readManifest(ports, target.path);

  if (!read.ok) {
    return { status: "failed", message: read.reason };
  }

  const { manifest } = read;
  const kind: PluginKind = target.kind;

  if (manifest.kind !== kind || manifest.name !== name) {
    return {
      status: "failed",
      message: `${target.path} manifest names a ${manifest.kind} called ${manifest.name}, not the ${kind} ${name}`,
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
      message: `${target.program} manifest has no prompt_version`,
    };
  }

  const existing = ports.registry.registered(request.root);

  if (
    kind === "describer" &&
    existing.describerProgram !== undefined &&
    existing.describerProgram !== target.program
  ) {
    throw new InvalidRequest([
      `${existing.describerProgram} is already the registered describer: remove it with recognizer config --unset describer.command before registering ${target.program}`,
    ]);
  }

  const outcome = ports.registry.register(request.root, {
    kind: target.kind,
    name,
    program: target.program,
    manifest: {
      install: manifest.install,
      ...(manifest.prompt_version === undefined
        ? {}
        : { prompt_version: manifest.prompt_version }),
    },
  });

  if (outcome.status === "refused") {
    return { status: "failed", message: outcome.reason };
  }

  return {
    status: "done",
    warnings:
      judgement === "previous"
        ? [
            `${target.program} speaks the previous protocol ${manifest.protocol}: install ${manifest.install}`,
          ]
        : [],
    line:
      outcome.status === "already-registered"
        ? `${target.program}: already registered`
        : `${target.program}: registered as ${kind === "sensor" ? `sensors.${name}` : "describer"}`,
  };
}
