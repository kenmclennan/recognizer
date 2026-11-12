import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { ModuleMetrics, Warning } from "./analyse.js";
import {
  type BaselineEntry,
  entryId,
  type Identity,
  identityOfViolationId,
  parseBaseline,
  serialiseBaseline,
} from "./baseline.js";
import { type Ranking, rankById } from "./check.js";
import type { Io } from "./cli.js";
import { readConfig } from "./config.js";
import { registeredSensors } from "./config-parse.js";
import { InputError } from "./errors.js";
import { orderDuplication } from "./findings.js";
import type { FindingRecord, FindingsDocument } from "./findings-document.js";
import { findingsFile, readFindingsFiles } from "./findings-files.js";
import type { FolderMetrics } from "./folder-metrics.js";
import { freshScans } from "./freshness.js";
import { scansCommit } from "./load-findings.js";
import { moduleNames } from "./neighbours.js";
import { type Policy, parsePolicy } from "./policy.js";
import type { Violation } from "./rules.js";
import { type Scan, validateScan } from "./scan.js";
import { shippedSensorNames } from "./shipped-sensors.js";
import { runStructureSensor } from "./structure-run.js";
import {
  describeSettings,
  resolveStructureSettings,
  type StructureSettings,
  structureSensor,
} from "./structure-sensor.js";
import { folderOf } from "./structure-warnings.js";
import { freshnessFor } from "./tests-hash.js";

type BaselineAction = "none" | "initialised" | "shrunk";

interface OtherFinding {
  id: string;
  principle: string;
  fix_pattern?: string;
  summary: string;
  evidence: FindingRecord["evidence"];
  finding_id?: string;
}

type ReportedViolation = Violation | OtherFinding;
type ReportedWarning = Warning | OtherFinding;

interface Candidate {
  id: string;
  entry: BaselineEntry;
  value: ReportedViolation;
}

interface Ranked {
  violations: ReportedViolation[];
  new: ReportedViolation[];
  fixed: BaselineEntry[];
  unranked: number;
}

interface SensorStatus {
  name: string;
  status: "ran" | "off" | "failed" | "stale" | "missing";
  reason?: string;
  settings?: StructureSettings;
  reported?: true;
  out_of_date?: number;
}

interface Gathered {
  documents: FindingsDocument[];
  metrics: ModuleMetrics[];
  folderMetrics: FolderMetrics[];
  unranked: number;
  sensors: SensorStatus[];
  hiddenIds: Set<string>;
}

function readInput(io: Io, path: string, what: string): string {
  try {
    return io.readFile(path);
  } catch {
    throw new InputError([`cannot read ${what} file: ${path}`]);
  }
}

function ruleLine(violation: Violation): string {
  const rules = violation.rules
    .map((rule) => {
      if (rule.type === "level") {
        return `level ${rule.from_level} -> ${rule.to_level}`;
      }

      if (rule.type === "uses") {
        return `uses ${rule.from_component} -> ${rule.to_component}`;
      }

      return `forbid ${rule.pattern}`;
    })
    .join("; ");

  return `${violation.from} -> ${violation.to} (${violation.kind}) line ${violation.lines.join(", ")}: ${rules}`;
}

function isStructureViolation(value: ReportedViolation): value is Violation {
  return "from" in value;
}

const TEST_FILE_LINES_SHOWN = 10;

function testFileLines(warning: ReportedWarning): string[] {
  const importers =
    warning.id === "orphan"
      ? (warning.evidence as FindingRecord["evidence"]).test_importers
      : undefined;

  if (!importers || importers.length === 0) {
    return [];
  }

  const lines = importers
    .slice(0, TEST_FILE_LINES_SHOWN)
    .map(
      (entry) =>
        `  ${entry.file}: ${entry.names.length === 0 ? "(names unknown)" : entry.names.join(", ")}`,
    );

  if (importers.length > TEST_FILE_LINES_SHOWN) {
    lines.push(
      `  and ${importers.length - TEST_FILE_LINES_SHOWN} more test files`,
    );
  }

  return lines;
}

function summary(
  result: Ranked | null,
  warnings: ReportedWarning[],
  listWarnings = false,
): string {
  const lines = (result?.new ?? []).map((violation) =>
    isStructureViolation(violation)
      ? ruleLine(violation)
      : `${violation.summary} (${violation.id})`,
  );

  if (result) {
    lines.push(
      `violations: ${result.violations.length}, new: ${result.new.length}, fixed: ${result.fixed.length}, unranked: ${result.unranked}`,
    );

    if (result.fixed.length > 0) {
      lines.push("run with --update-baseline to shrink the baseline");
    }
  }

  lines.push(`warnings: ${warnings.length}`);

  if (listWarnings) {
    for (const warning of warnings) {
      lines.push(`warning: ${warning.summary}`, ...testFileLines(warning));
    }
  }

  return `${lines.join("\n")}\n`;
}

function violationOf(sensor: string, record: FindingRecord): Candidate {
  const edge = record.evidence.edges?.[0];

  if (
    sensor === "structure" &&
    record.kind === "rule-violation" &&
    edge !== undefined &&
    edge.kind !== undefined &&
    edge.lines !== undefined
  ) {
    const identity: Identity = {
      from: edge.from,
      to: edge.to,
      kind: edge.kind,
    };

    return {
      id: record.id,
      entry: identity,
      value: {
        from: edge.from,
        to: edge.to,
        kind: edge.kind,
        lines: edge.lines,
        rules: edge.rules ?? [],
      },
    };
  }

  return {
    id: record.id,
    entry: { id: record.id },
    value: {
      id: record.kind,
      principle: record.principle,
      fix_pattern: record.fix_pattern,
      summary: record.summary,
      evidence: record.evidence,
      finding_id: record.id,
    },
  };
}

function warningOf(sensor: string, record: FindingRecord): ReportedWarning {
  if (sensor === "structure" && record.kind === "cycle") {
    return {
      id: "cycle",
      principle: "no-cycles",
      fix_pattern: "break-cycle",
      summary: record.summary,
      evidence: {
        modules: record.evidence.modules,
        edges: (record.evidence.edges ?? []).map(({ from, to }) => ({
          from,
          to,
        })),
      },
    };
  }

  return {
    id: record.kind,
    principle: record.principle,
    fix_pattern: record.fix_pattern,
    summary: record.summary,
    evidence: record.evidence,
  } as OtherFinding;
}

function candidatesOf(documents: FindingsDocument[]): Candidate[] {
  return documents.flatMap((document) =>
    document.findings
      .filter((record) => record.severity === "violation")
      .map((record) => violationOf(document.sensor.name, record)),
  );
}

function warningsOf(documents: FindingsDocument[]): ReportedWarning[] {
  return documents.flatMap((document) =>
    orderDuplication(document.findings)
      .filter((record) => record.severity === "warning")
      .map((record) => warningOf(document.sensor.name, record)),
  );
}

function rankCandidates(
  candidates: Candidate[],
  unranked: number,
  baseline: BaselineEntry[] | null,
): Ranked {
  const ranking: Ranking<Candidate> = rankById(candidates, baseline);

  return {
    violations: candidates.map((one) => one.value),
    new: ranking.new.map((one) => one.value),
    fixed: ranking.fixed,
    unranked,
  };
}

const OPTIONS = {
  scan: { type: "string" },
  repository: { type: "string" },
  json: { type: "boolean" },
  policy: { type: "string" },
  baseline: { type: "string" },
  "update-baseline": { type: "boolean" },
  "init-baseline": { type: "boolean" },
} as const;

interface BaselineFlags {
  baseline: string | undefined;
  update: boolean;
  init: boolean;
}

function settleBaseline(
  io: Io,
  flags: BaselineFlags,
  baselinePath: string,
  candidates: Candidate[],
  unranked: number,
  hiddenIds: Set<string> = new Set(),
): {
  result: Ranked;
  report: { path: string; present: boolean; action: BaselineAction };
} {
  const present = io.exists(baselinePath);
  const baseline = present
    ? parseBaseline(readInput(io, baselinePath, "baseline"))
    : null;

  if (flags.init && present) {
    throw new InputError([`baseline already exists: ${baselinePath}`]);
  }

  if (flags.update && !present) {
    throw new InputError([`baseline does not exist: ${baselinePath}`]);
  }

  let result = rankCandidates(candidates, unranked, baseline);

  result = {
    ...result,
    fixed: result.fixed.filter((entry) => !hiddenIds.has(entryId(entry))),
  };

  let action: BaselineAction = "none";

  if (flags.init) {
    const entries = candidates.map((one) => one.entry);

    io.writeFile(baselinePath, serialiseBaseline(entries));
    result = rankCandidates(candidates, unranked, entries);
    action = "initialised";
  } else if (
    flags.update &&
    result.new.length === 0 &&
    result.fixed.length > 0
  ) {
    const fixedIds = new Set(result.fixed.map(entryId));
    const kept = (baseline ?? []).filter(
      (entry) => !fixedIds.has(entryId(entry)),
    );
    io.writeFile(baselinePath, serialiseBaseline(kept));
    action = "shrunk";
  }

  return { result, report: { path: baselinePath, present, action } };
}

function rejectBaselineFlagsWithoutPolicy(
  flags: BaselineFlags,
  policyGiven: boolean,
): void {
  if (
    !policyGiven &&
    (flags.baseline !== undefined || flags.update || flags.init)
  ) {
    throw new InputError([
      "--baseline, --update-baseline and --init-baseline need --policy",
    ]);
  }

  if (flags.update && flags.init) {
    throw new InputError([
      "--update-baseline and --init-baseline cannot be used together",
    ]);
  }
}

function analysisReport(
  warnings: ReportedWarning[],
  metrics: ModuleMetrics[],
  folderMetrics: FolderMetrics[],
) {
  return {
    warnings,
    metrics,
    folder_metrics: folderMetrics,
  };
}

function executeScanReplay(
  values: {
    scan: string;
    policy?: string;
    baseline?: string;
    "update-baseline"?: boolean;
    "init-baseline"?: boolean;
  },
  io: Io,
): number {
  const flags: BaselineFlags = {
    baseline: values.baseline,
    update: values["update-baseline"] === true,
    init: values["init-baseline"] === true,
  };

  rejectBaselineFlagsWithoutPolicy(flags, Boolean(values.policy));

  let scan: unknown;

  try {
    scan = JSON.parse(readInput(io, values.scan, "scan"));
  } catch (error) {
    if (error instanceof InputError) {
      throw error;
    }

    throw new InputError([
      `scan is not valid JSON: ${(error as Error).message}`,
    ]);
  }

  const policy = values.policy
    ? parsePolicy(readInput(io, values.policy, "policy"))
    : null;
  const settings: StructureSettings = {
    entry_points: [],
    warnings: {
      cycle: true,
      orphan: true,
      policy_drift: true,
      unused_exports: false,
    },
  };
  const sensed = structureSensor([validateScan(scan)], policy, settings, {
    commit: "",
    modified: false,
  });
  const warnings = warningsOf([sensed.document]);

  if (policy === null) {
    io.stdout(
      `${JSON.stringify(analysisReport(warnings, sensed.metrics, sensed.folder_metrics), null, 2)}\n`,
    );
    io.stderr(summary(null, warnings));

    return 0;
  }

  const baselinePath =
    values.baseline ??
    join(dirname(values.policy as string), "baselines", "violations.json");
  const { result, report } = settleBaseline(
    io,
    flags,
    baselinePath,
    candidatesOf([sensed.document]),
    sensed.unranked,
  );

  io.stdout(
    `${JSON.stringify({ ...result, baseline: report, ...analysisReport(warnings, sensed.metrics, sensed.folder_metrics) }, null, 2)}\n`,
  );
  io.stderr(summary(result, warnings));

  return result.new.length > 0 ? 1 : 0;
}

function violationModules(value: ReportedViolation): string[] {
  if (isStructureViolation(value)) {
    return [value.from, value.to];
  }

  return [
    ...value.evidence.modules,
    ...(value.evidence.edges ?? []).flatMap((edge) => [edge.from, edge.to]),
  ];
}

function warningModules(warning: ReportedWarning): string[] {
  return (warning.evidence as { modules: string[] }).modules;
}

function entryModules(entry: BaselineEntry): string[] {
  const identity = "id" in entry ? identityOfViolationId(entry.id) : entry;

  return identity === null ? [] : [identity.from, identity.to];
}

function touches(modules: Set<string>, names: string[]): boolean {
  return names.some((name) => modules.has(name));
}

function defaultPolicyFile(io: Io, root: string): string | null {
  const file = join(root, ".recognizer", "policy.yaml");

  return io.exists(file) ? file : null;
}

function gather(
  io: Io,
  root: string,
  scans: Scan[],
  policy: Policy | null,
): Gathered {
  const config = readConfig(io, root);
  const { commit } = scansCommit(scans);
  const hiddenIds = new Set<string>();
  const sensors: SensorStatus[] = [];
  const documents: FindingsDocument[] = [];
  const resolved = resolveStructureSettings(config);
  let metrics: ModuleMetrics[] = [];
  let folderMetrics: FolderMetrics[] = [];
  let unranked = 0;

  const fail = (name: string, reason: string) => {
    io.remove(findingsFile(root, name));
    io.stderr(`failed ${name}: ${reason}\n`);
    sensors.push({ name, status: "failed", reason });
  };

  if (resolved === "off") {
    io.remove(findingsFile(root, "structure"));
    sensors.push({ name: "structure", status: "off" });
  } else {
    const run = runStructureSensor(io, root, scans, policy, resolved);
    const { sensed } = run;

    metrics = sensed.metrics;
    folderMetrics = sensed.folder_metrics;
    unranked = sensed.unranked;

    if (run.error !== null) {
      fail("structure", run.error);
    } else {
      if (commit === null) {
        documents.push(sensed.document);
      }

      sensors.push({ name: "structure", status: "ran", settings: resolved });
    }
  }

  if (commit !== null) {
    const allowed = [
      ...(resolved === "off" ? [] : ["structure"]),
      ...registeredSensors(config).map(({ name }) => name),
      ...shippedSensorNames(),
    ];

    for (const outcome of readFindingsFiles(
      io,
      root,
      freshnessFor(io, root, scans),
      [],
      allowed,
    )) {
      if (outcome.status === "unregistered") {
        io.remove(findingsFile(root, outcome.name));
        io.stderr(`removed unregistered ${outcome.name}\n`);
      } else if (outcome.status === "read") {
        const { document, hidden, valid } = outcome;

        for (const record of hidden) {
          if (record.severity === "violation") {
            hiddenIds.add(violationOf(outcome.name, record).id);
          }
        }

        documents.push(document);

        if (!valid) {
          io.stderr(
            outcome.reported
              ? `stale ${outcome.name} (reported at ${document.commit.slice(0, 7)})\n`
              : `stale ${outcome.name}\n`,
          );
        } else if (hidden.length > 0) {
          io.stderr(`out of date ${outcome.name}: ${hidden.length} findings\n`);
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
        io.stderr(`invalid ${outcome.name}: ${outcome.reason}\n`);
        sensors.push({
          name: outcome.name,
          status: "failed",
          reason: outcome.reason,
        });
      }
    }
  }

  for (const { name } of registeredSensors(config)) {
    if (!sensors.some((one) => one.name === name)) {
      sensors.push({ name, status: "missing" });
    }
  }

  return {
    documents,
    metrics,
    folderMetrics,
    unranked,
    sensors,
    hiddenIds,
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

  throw new InputError([
    ...hidden.map(
      (one) =>
        `--init-baseline refused: ${one.name} has ${REASON[one.status] ?? "invalid"} results`,
    ),
    `rerun them with recognizer scan --sense ${names.join(",")}, then run --init-baseline again`,
  ]);
}

function executeRepository(
  values: {
    repository?: string;
    json?: boolean;
    policy?: string;
    baseline?: string;
    "update-baseline"?: boolean;
    "init-baseline"?: boolean;
  },
  named: string[],
  io: Io,
): number {
  const root = resolve(values.repository ?? ".");
  const policyFile = values.policy ?? defaultPolicyFile(io, root);
  const flags: BaselineFlags = {
    baseline: values.baseline,
    update: values["update-baseline"] === true,
    init: values["init-baseline"] === true,
  };

  rejectBaselineFlagsWithoutPolicy(flags, policyFile !== null);

  if (named.length > 0 && (flags.update || flags.init)) {
    throw new InputError([
      "--update-baseline and --init-baseline check the whole repository and take no module",
    ]);
  }

  const { scans } = freshScans(io, root);
  const known = new Set(moduleNames(scans));
  const unknown = named.filter((id) => !known.has(id));

  if (unknown.length > 0) {
    throw new InputError(unknown.map((id) => `no such module: ${id}`));
  }

  const listed = new Set(named);
  const narrowed = named.length > 0;
  const policy =
    policyFile === null
      ? null
      : parsePolicy(readInput(io, policyFile, "policy"));

  const gathered = gather(io, root, scans, policy);

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
  const analysis = analysisReport(warnings, metrics, folderMetrics);
  const candidates = candidatesOf(gathered.documents);
  const settings = gathered.sensors.find((one) => one.name === "structure");
  const sensorLine = `sensor structure: ${
    settings?.settings
      ? describeSettings(settings.settings)
      : (settings?.status ?? "off")
  }\n`;
  const exit = (fresh: number) => (failed ? 1 : fresh > 0 ? 1 : 0);

  if (policy === null && candidates.length === 0) {
    io.stdout(
      values.json
        ? `${JSON.stringify({ ...analysis, sensors: gathered.sensors }, null, 2)}\n`
        : `${sensorLine}${summary(null, warnings, true)}`,
    );

    return exit(0);
  }

  const baselinePath =
    values.baseline ??
    join(
      policyFile === null ? join(root, ".recognizer") : dirname(policyFile),
      "baselines",
      "violations.json",
    );
  const settled = settleBaseline(
    io,
    flags,
    baselinePath,
    candidates,
    gathered.unranked,
    gathered.hiddenIds,
  );
  const result: Ranked = narrowed
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
        unranked: settled.result.unranked,
      }
    : settled.result;

  io.stdout(
    values.json
      ? `${JSON.stringify({ ...result, baseline: settled.report, ...analysis, sensors: gathered.sensors }, null, 2)}\n`
      : `${sensorLine}${summary(result, warnings, true)}`,
  );

  return exit(result.new.length);
}

export function executeCheck(argv: string[], io: Io): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: OPTIONS,
  });

  if (values.scan === undefined) {
    return executeRepository(values, positionals, io);
  }

  if (
    positionals.length !== 0 ||
    values.json !== undefined ||
    values.repository !== undefined
  ) {
    throw new InputError([
      "usage: recognizer check --scan <scan.json> [--policy <policy.yaml>]",
    ]);
  }

  return executeScanReplay({ ...values, scan: values.scan }, io);
}
