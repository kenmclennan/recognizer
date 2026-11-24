import {
  complexityUnmeasured,
  duplicationUnmeasured,
} from "../../domain/analysis/duplication/carry.js";
import { folderOf } from "../../domain/analysis/folder-of.js";
import { scansCommit } from "../../domain/analysis/scans-commit.js";
import { narrowUnknownFiles } from "../../domain/analysis/unknown-files.js";
import type { ConfigRepository } from "../../domain/config-repository.js";
import type { FindingsRepository } from "../../domain/findings-repository.js";
import { InvalidRequest } from "../../domain/invalid-request.js";
import type { PolicyRepository } from "../../domain/policy-repository.js";
import type { PolicyRule } from "../../domain/policy-rule.js";
import type { Repository } from "../../domain/repository.js";
import type { SensorFindings } from "../../domain/sensor-findings.js";
import type { StructureSettings } from "../../domain/structure-settings.js";
import type { UnknownFiles } from "../../domain/unknown-files.js";
import {
  type BaselineEntry,
  type BaselineFlags,
  type BaselineReport,
  type BaselineRepository,
  identityOfViolationId,
  type Ranked,
  type ReportedViolation,
  settleBaseline,
} from "../history/settle-baseline.js";
import type { Say } from "../shared/ports/process.js";
import {
  candidatesOf,
  type ReportedWarning,
  violationOf,
  warningsOf,
} from "./check-findings.js";
import type { FolderMetrics } from "./measure-folders.js";
import type { ModuleMetrics } from "./measure-modules.js";
import type { Analysis } from "./ports/analysis.js";
import type { Digest } from "./ports/digest.js";
import type { PublishedLanguages } from "./ports/published-languages.js";
import type { SourceFiles } from "./ports/source-files.js";
import type { TestReports } from "./ports/test-reports.js";
import { freshnessFor, readFindingsFiles } from "./read-findings-files.js";
import { runStructureAnalysis } from "./run-structure-analysis.js";

export interface SensorStatus {
  name: string;
  status: "ran" | "partial" | "off" | "failed" | "stale" | "missing";
  reason?: string;
  not_measured?: string[];
  settings?: StructureSettings;
  reported?: true;
  out_of_date?: number;
}

export interface CheckPorts {
  analysis: Analysis;
  config: ConfigRepository;
  findings: FindingsRepository;
  policy: PolicyRepository;
  baselines: BaselineRepository;
  source: SourceFiles;
  digest: Digest;
  testReports: TestReports;
  languages: PublishedLanguages;
}

export interface CheckRequest {
  root: string;
  policyFile: string | null;
  baselinePath: string;
  flags: BaselineFlags;
  named: string[];
}

export interface CheckReport {
  ranked: Ranked | null;
  baseline: BaselineReport | null;
  warnings: ReportedWarning[];
  metrics: ModuleMetrics[];
  folderMetrics: FolderMetrics[];
  sensors: SensorStatus[];
  unknownFiles: UnknownFiles | null;
  exit: 0 | 1;
}

export function refuseBadBaselineFlags(
  flags: BaselineFlags,
  policyGiven: boolean,
): void {
  if (
    !policyGiven &&
    (flags.baseline !== undefined || flags.update || flags.init)
  ) {
    throw new InvalidRequest([
      "--baseline, --update-baseline and --init-baseline need --policy",
    ]);
  }

  if (flags.update && flags.init) {
    throw new InvalidRequest([
      "--update-baseline and --init-baseline cannot be used together",
    ]);
  }
}

export function refuseBadCheckRequest(request: CheckRequest): void {
  refuseBadBaselineFlags(request.flags, request.policyFile !== null);

  if (
    request.named.length > 0 &&
    (request.flags.update || request.flags.init)
  ) {
    throw new InvalidRequest([
      "--update-baseline and --init-baseline check the whole repository and take no file",
    ]);
  }
}

interface Gathered {
  documents: SensorFindings[];
  metrics: ModuleMetrics[];
  folderMetrics: FolderMetrics[];
  sensors: SensorStatus[];
  hiddenKeys: Set<string>;
  unknownFiles: UnknownFiles | null;
}

function gather(
  ports: CheckPorts,
  say: Say,
  root: string,
  repository: Repository,
  policy: readonly PolicyRule[] | null,
): Gathered {
  const { commit } = scansCommit(repository);
  const hiddenKeys = new Set<string>();
  const sensors: SensorStatus[] = [];
  const documents: SensorFindings[] = [];
  const resolved = ports.config.structureSettings(root);
  const registered = ports.config.sensorNames(root);
  let metrics: ModuleMetrics[] = [];
  let folderMetrics: FolderMetrics[] = [];
  let unknownFiles: UnknownFiles | null = null;

  const fail = (name: string, reason: string) => {
    ports.findings.remove(root, name);
    say("stderr", `failed ${name}: ${reason}\n`);
    sensors.push({ name, status: "failed", reason });
  };

  if (resolved === "off") {
    ports.findings.remove(root, "structure");
    sensors.push({ name: "structure", status: "off" });
  } else {
    const run = runStructureAnalysis(ports, {
      say,
      root,
      repository,
      policy,
      settings: resolved,
      parsers: null,
      rules: [],
    });
    const { sensed } = run;

    metrics = sensed.metrics;
    folderMetrics = sensed.folder_metrics;

    if (run.error !== null) {
      fail("structure", run.error);
    } else {
      unknownFiles = sensed.document.unknownFiles ?? null;

      if (commit === null) {
        documents.push(sensed.document);
      }

      const notMeasured: string[] = [];

      if (duplicationUnmeasured(sensed.document, resolved)) {
        notMeasured.push("duplication");
        say(
          "stderr",
          "duplication not measured since the last scan: run recognizer scan\n",
        );
      }

      if (complexityUnmeasured(sensed.document, resolved)) {
        notMeasured.push("complexity");
        say(
          "stderr",
          "complexity not measured since the last scan: run recognizer scan\n",
        );
      }

      sensors.push(
        notMeasured.length === 0
          ? { name: "structure", status: "ran", settings: resolved }
          : {
              name: "structure",
              status: "partial",
              settings: resolved,
              not_measured: notMeasured,
            },
      );
    }
  }

  if (commit !== null) {
    const allowed = [
      ...(resolved === "off" ? [] : ["structure"]),
      ...registered,
    ];

    for (const outcome of readFindingsFiles(
      ports.findings.readAll(root),
      freshnessFor(
        {
          source: ports.source,
          digest: ports.digest,
          testReports: ports.testReports,
          languages: ports.languages,
        },
        root,
        repository,
      ),
      [],
      allowed,
    )) {
      if (outcome.status === "unregistered") {
        say("stderr", `ignored unregistered ${outcome.name}\n`);
      } else if (outcome.status === "read") {
        const { document, hidden, valid } = outcome;

        for (const record of hidden) {
          if (record.severity === "violation") {
            for (const key of violationOf(outcome.name, record).keys) {
              hiddenKeys.add(key);
            }
          }
        }

        documents.push(document);

        if (!valid) {
          say(
            "stderr",
            outcome.reported
              ? `stale ${outcome.name} (reported at ${document.commit.slice(0, 7)})\n`
              : `stale ${outcome.name}\n`,
          );
        } else if (hidden.length > 0) {
          say(
            "stderr",
            `out of date ${outcome.name}: ${hidden.length} findings\n`,
          );
        }

        if (!sensors.some((one) => one.name === outcome.name)) {
          sensors.push({
            name: outcome.name,
            status: valid ? "ran" : "stale",
            ...(valid && hidden.length > 0
              ? { out_of_date: hidden.length }
              : {}),
            ...(outcome.reported ? { reported: true } : {}),
          });
        }
      } else {
        say("stderr", `invalid ${outcome.name}: ${outcome.reason}\n`);
        sensors.push({
          name: outcome.name,
          status: "failed",
          reason: outcome.reason,
        });
      }
    }
  }

  for (const name of registered) {
    if (!sensors.some((one) => one.name === name)) {
      sensors.push({ name, status: "missing" });
    }
  }

  return {
    documents,
    metrics,
    folderMetrics,
    sensors,
    hiddenKeys,
    unknownFiles,
  };
}

const REASON: Record<string, string> = { ran: "out of date", stale: "stale" };

function refuseInitWithHiddenFindings(sensors: SensorStatus[]): void {
  const hidden = sensors.filter(
    (one) =>
      one.name !== "structure" &&
      (one.status === "stale" ||
        one.status === "failed" ||
        (one.out_of_date ?? 0) > 0),
  );

  if (hidden.length === 0) {
    return;
  }

  const names = hidden.map((one) => one.name);

  throw new InvalidRequest([
    ...hidden.map(
      (one) =>
        `--init-baseline refused: ${one.name} has ${REASON[one.status] ?? "invalid"} results`,
    ),
    `rerun them with recognizer scan --sense ${names.join(",")}, then run --init-baseline again`,
  ]);
}

function violationModules(value: ReportedViolation): string[] {
  if (value.type === "violation") {
    const { violation } = value.value;

    return [violation.file, ...violation.dependencies.map((one) => one.to)];
  }

  return [
    ...value.value.files,
    ...(value.value.dependencies ?? []).flatMap((edge) => [edge.from, edge.to]),
  ];
}

function warningModules(warning: ReportedWarning): string[] {
  return [...warning.value.files];
}

function entryModules(entry: BaselineEntry): string[] {
  const identity = "id" in entry ? identityOfViolationId(entry.id) : entry;

  return identity === null ? [] : [identity.from, identity.to];
}

function touches(modules: Set<string>, names: string[]): boolean {
  return names.some((name) => modules.has(name));
}

export function checkRepository(
  ports: CheckPorts,
  say: Say,
  request: CheckRequest,
  repository: Repository,
): CheckReport {
  const { root, policyFile, flags, named } = request;
  const known = new Set(repository.files.map((file) => file.path));
  const unknown = named.filter((id) => !known.has(id));

  if (unknown.length > 0) {
    throw new InvalidRequest(unknown.map((id) => `no such file: ${id}`));
  }

  const listed = new Set(named);
  const narrowed = named.length > 0;
  const policy = policyFile === null ? null : ports.policy.rulesAt(policyFile);

  if (policyFile !== null) {
    ports.analysis.reportPolicyProblems(
      root,
      repository,
      policy,
      say,
      policyFile,
    );
  }

  const gathered = gather(ports, say, root, repository, policy);

  if (flags.init) {
    refuseInitWithHiddenFindings(gathered.sensors);
  }

  const failed = gathered.sensors.some((one) => one.status === "failed");
  const allWarnings = warningsOf(gathered.documents);
  const warnings = narrowed
    ? allWarnings.filter((warning) => touches(listed, warningModules(warning)))
    : allWarnings;
  const metrics = narrowed
    ? gathered.metrics.filter((metric) => listed.has(metric.id))
    : gathered.metrics;
  const folderMetrics = narrowed
    ? gathered.folderMetrics.filter((row) =>
        named.some((id) => folderOf(id) === row.id),
      )
    : gathered.folderMetrics;
  const unknownFiles = narrowed
    ? narrowUnknownFiles(gathered.unknownFiles, repository, listed)
    : gathered.unknownFiles;
  const candidates = candidatesOf(gathered.documents);
  const exit = (fresh: number): 0 | 1 => (failed ? 1 : fresh > 0 ? 1 : 0);

  if (policy === null && candidates.length === 0) {
    return {
      ranked: null,
      baseline: null,
      warnings,
      metrics,
      folderMetrics,
      sensors: gathered.sensors,
      unknownFiles,
      exit: exit(0),
    };
  }

  const settled = settleBaseline(
    ports.baselines,
    flags,
    request.baselinePath,
    candidates,
    gathered.hiddenKeys,
  );
  const ranked: Ranked = narrowed
    ? {
        violations: settled.result.violations.filter((one) =>
          touches(listed, violationModules(one)),
        ),
        new: settled.result.new.filter((one) =>
          touches(listed, violationModules(one)),
        ),
        fixed: settled.result.fixed.filter((one) =>
          touches(listed, entryModules(one)),
        ),
      }
    : settled.result;

  return {
    ranked,
    baseline: settled.report,
    warnings,
    metrics,
    folderMetrics,
    sensors: gathered.sensors,
    unknownFiles,
    exit: exit(ranked.new.length),
  };
}
