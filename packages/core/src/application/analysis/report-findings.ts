import type { FindingsRepository } from "../../domain/findings-repository.js";
import { InvalidRequest } from "../../domain/invalid-request.js";
import type { Repository } from "../../domain/repository.js";
import type { SensorFindings } from "../../domain/sensor-findings.js";
import type { Clock } from "../shared/ports/clock.js";
import type { Git } from "../shared/ports/git.js";
import type { Analysis } from "./ports/analysis.js";
import { measuredInputs } from "./sense-structure.js";
import type { SensorsInEffect } from "./sensors-in-effect.js";

export interface ReportPorts {
  analysis: Analysis;
  catalog: SensorsInEffect;
  findings: FindingsRepository;
  git: Git;
  clock: Clock;
}

export interface ReportRequest {
  root: string;
  as: string | undefined;
  findingsText: () => string;
  repository: () => Repository;
}

export type ReportOutcome =
  | { ok: true; name: string; commit: string; document: SensorFindings }
  | { ok: false; message: string };

const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

function requireName(
  ports: ReportPorts,
  root: string,
  name: string | undefined,
): string {
  if (name === undefined) {
    throw new InvalidRequest(["report needs --as <name>"]);
  }

  if (!NAME_PATTERN.test(name) || name.length > 64) {
    throw new InvalidRequest([
      `--as ${name} is not a sensor name: lowercase letters, digits, - and _, at most 64`,
    ]);
  }

  const taken = [
    "structure",
    ...ports.catalog.sensorsInEffect().map(({ name }) => name),
  ];

  if (taken.includes(name)) {
    throw new InvalidRequest([
      `--as ${name} is a sensor the scan runs; a report needs a name of its own`,
    ]);
  }

  return name;
}

function ownVersion(document: unknown): string {
  const sensor = (document as { sensor?: { version?: unknown } } | null)
    ?.sensor;

  return typeof sensor?.version === "string" && sensor.version !== ""
    ? sensor.version
    : "reported";
}

export function reportFindings(
  ports: ReportPorts,
  request: ReportRequest,
): ReportOutcome {
  const { root } = request;
  const name = requireName(ports, root, request.as);
  const commit = ports.git.commit(root);

  if (commit === null) {
    throw new InvalidRequest([
      "a report is stamped with the commit it was made at, and this folder has none",
    ]);
  }

  const text = request.findingsText();
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      message: `findings are not JSON: ${(error as Error).message}`,
    };
  }

  const source =
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  const { findings } = source;
  const repository = request.repository();
  let document: SensorFindings;

  try {
    document = ports.findings.documentOfReport({
      name,
      version: ownVersion(parsed),
      commit,
      modified: ports.git.dirty(root),
      reportedAt: new Date(ports.clock.now()).toISOString(),
      findings,
      inputs: measuredInputs(repository),
    });
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }

  ports.findings.save(root, document);

  return { ok: true, name, commit, document };
}
