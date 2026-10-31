import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { ModuleMetrics, Thresholds, Warning } from "./analyse.js";
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
import {
  type FindingRecord,
  type FindingsDocument,
  validateFindings,
} from "./findings-document.js";
import {
  findingsFile,
  readFindingsFiles,
  writeFindings,
} from "./findings-files.js";
import { freshScans } from "./freshness.js";
import { scansCommit } from "./load-findings.js";
import { moduleNames } from "./neighbours.js";
import { type Policy, parsePolicy } from "./policy.js";
import { runRegistered } from "./registered-command.js";
import type { Violation } from "./rules.js";
import { type Scan, validateScan } from "./scan.js";
import {
  DEFAULT_HUB_THRESHOLD,
  describeSettings,
  resolveStructureSettings,
  type StructureSettings,
  structureSensor,
} from "./structure-sensor.js";

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
  status: "ran" | "off" | "failed" | "stale";
  reason?: string;
  settings?: StructureSettings;
}

interface Gathered {
  documents: FindingsDocument[];
  metrics: ModuleMetrics[];
  unranked: number;
  thresholds: Thresholds | null;
  sensors: SensorStatus[];
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
    lines.push(...warnings.map((warning) => `warning: ${warning.summary}`));
  }

  return `${lines.join("\n")}\n`;
}

function parseThreshold(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return undefined;
  }

  if (!/^\d+$/.test(raw) || Number(raw) < 1) {
    throw new InputError([`--hub-threshold must be an integer >= 1: ${raw}`]);
  }

  return Number(raw);
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
  const measures = record.evidence.measures;

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

  if (sensor === "structure" && record.kind === "hub" && measures) {
    return {
      id: "hub",
      principle: "interfaces-are-narrow-and-explicit",
      fix_pattern: "split-hub",
      summary: record.summary,
      evidence: {
        module: record.evidence.modules[0] as string,
        fan_in: measures.fan_in as number,
        fan_out: measures.fan_out as number,
        threshold: measures.threshold as number,
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
    document.findings
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
  "hub-threshold": { type: "string" },
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
  thresholds: Thresholds | null,
  warnings: ReportedWarning[],
  metrics: ModuleMetrics[],
) {
  return {
    ...(thresholds === null ? {} : { thresholds }),
    warnings,
    metrics,
  };
}

function executeScanReplay(
  values: {
    scan: string;
    policy?: string;
    baseline?: string;
    "update-baseline"?: boolean;
    "init-baseline"?: boolean;
    "hub-threshold"?: string;
  },
  io: Io,
): number {
  const hubThreshold =
    parseThreshold(values["hub-threshold"]) ?? DEFAULT_HUB_THRESHOLD;
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
    hub_threshold: hubThreshold,
    warnings: { cycle: true, hub: true },
  };
  const sensed = structureSensor([validateScan(scan)], policy, settings, {
    commit: "",
    modified: false,
  });
  const thresholds = { hub: hubThreshold };
  const warnings = warningsOf([sensed.document]);

  if (policy === null) {
    io.stdout(
      `${JSON.stringify(analysisReport(thresholds, warnings, sensed.metrics), null, 2)}\n`,
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
    `${JSON.stringify({ ...result, baseline: report, ...analysisReport(thresholds, warnings, sensed.metrics) }, null, 2)}\n`,
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
  if (warning.id === "hub") {
    return [(warning.evidence as { module: string }).module];
  }

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
  override: number | undefined,
): Gathered {
  const config = readConfig(io, root);
  const { commit, modified } = scansCommit(scans);
  const sensors: SensorStatus[] = [];
  const documents: FindingsDocument[] = [];
  const resolved = resolveStructureSettings(config, override);
  let metrics: ModuleMetrics[] = [];
  let unranked = 0;
  let thresholds: Thresholds | null = null;

  const fail = (name: string, reason: string) => {
    io.remove(findingsFile(root, name));
    io.stderr(`failed ${name}: ${reason}\n`);
    sensors.push({ name, status: "failed", reason });
  };

  for (const { name, command } of registeredSensors(config)) {
    if (commit === null) {
      fail(name, "not a git repository, or no commit");

      continue;
    }

    const reason = runRegistered(
      io,
      root,
      command,
      commit,
      findingsFile(root, name),
      "findings",
      (document) => {
        validateFindings(document, { name, commit });
      },
    );

    if (reason === null) {
      sensors.push({ name, status: "ran" });
    } else {
      fail(name, reason);
    }
  }

  if (resolved === "off") {
    io.remove(findingsFile(root, "structure"));
    sensors.push({ name: "structure", status: "off" });
  } else {
    const sensed = structureSensor(scans, policy, resolved, {
      commit: commit ?? "",
      modified,
    });

    metrics = sensed.metrics;
    unranked = sensed.unranked;

    try {
      if (commit === null) {
        documents.push(sensed.document);
      } else {
        writeFindings(io, root, sensed.document);
      }

      thresholds = { hub: resolved.hub_threshold };
      sensors.push({ name: "structure", status: "ran", settings: resolved });
    } catch (error) {
      fail("structure", (error as Error).message);
    }
  }

  if (commit !== null) {
    for (const outcome of readFindingsFiles(io, root, commit)) {
      if (outcome.status === "read") {
        documents.push(outcome.document);

        if (!sensors.some((one) => one.name === outcome.name)) {
          sensors.push({ name: outcome.name, status: "ran" });
        }
      } else if (outcome.status === "stale") {
        io.stderr(`stale ${outcome.name}\n`);
        sensors.push({ name: outcome.name, status: "stale" });
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

  return { documents, metrics, unranked, thresholds, sensors };
}

function executeRepository(
  values: {
    repository?: string;
    json?: boolean;
    policy?: string;
    baseline?: string;
    "update-baseline"?: boolean;
    "init-baseline"?: boolean;
    "hub-threshold"?: string;
  },
  named: string[],
  io: Io,
): number {
  const override = parseThreshold(values["hub-threshold"]);
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

  const gathered = gather(io, root, scans, policy, override);
  const failed = gathered.sensors.some((one) => one.status === "failed");
  const allWarnings = warningsOf(gathered.documents);
  const warnings = narrowed
    ? allWarnings.filter((warning) => touches(listed, warningModules(warning)))
    : allWarnings;
  const metrics = narrowed
    ? gathered.metrics.filter((metric) => listed.has(metric.id))
    : gathered.metrics;
  const analysis = analysisReport(gathered.thresholds, warnings, metrics);
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
