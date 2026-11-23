import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  type BaselineRepository,
  type Finding,
  type PolicyRule,
  type Repository,
  type SensorFindings,
  Violation,
  type Warning,
} from "@recognizer/core";
import { BaselineAdapter } from "./adapters/filesystem/baseline-adapter.js";
import {
  documentRuleOf,
  findingRecordOf,
} from "./adapters/filesystem/findings-translator.js";
import { parsePolicy } from "./adapters/filesystem/policy-translator.js";
import { readScanFile } from "./adapters/filesystem/scan-translator.js";
import type { ModuleMetrics } from "./analyse.js";
import {
  type BaselineEntry,
  type Identity,
  identityKey,
  identityOfViolationId,
} from "./baseline.js";
import { type Ranking, rankByKeys } from "./check.js";
import type { Io } from "./cli.js";
import { policyFile, readConfig } from "./config.js";
import { registeredSensors } from "./config-parse.js";
import {
  complexityUnmeasured,
  duplicationUnmeasured,
} from "./duplication/carry.js";
import { InputError } from "./errors.js";
import { orderDuplication, ruleText } from "./findings.js";
import { findingsFile, readFindingsFiles } from "./findings-files.js";
import type { FolderMetrics } from "./folder-metrics.js";
import { freshScans } from "./freshness.js";
import { COMPLEXITY_LIMIT, LONG_FUNCTION } from "./function-length.js";
import { scansCommit } from "./load-findings.js";
import { moduleNames } from "./neighbours.js";
import { warnPolicyProblems } from "./policy-problems.js";
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

type FindingEvidence = ReturnType<typeof findingRecordOf>["evidence"];

type BaselineAction = "none" | "initialised" | "shrunk";

interface OtherFinding {
  id: string;
  principle: string;
  fix_pattern?: string;
  summary: string;
  evidence: FindingEvidence;
  finding_id?: string;
}

interface PrintedCycle {
  id: "cycle";
  principle: "levelization";
  fix_pattern: "break-cycle";
  summary: string;
  evidence: { modules: string[]; edges: { from: string; to: string }[] };
}

interface PrintedViolation {
  from: string;
  rule: ReturnType<typeof documentRuleOf>;
  imports: { to: string; kind: string; lines: number[] }[];
  grown?: true;
}

type GrownViolation = { violation: Violation; grown: boolean };
type ReportedViolation =
  | { type: "violation"; value: GrownViolation }
  | { type: "other"; value: OtherFinding };
type ReportedWarning =
  | { type: "cycle"; value: Warning }
  | { type: "finding"; value: Finding };

function printViolation({
  violation,
  grown,
}: GrownViolation): PrintedViolation {
  const printed: PrintedViolation = {
    from: violation.file,
    rule: documentRuleOf(violation.rule),
    imports: violation.dependencies.map((one) => ({
      to: one.to,
      kind: one.kind,
      lines: [...one.lines],
    })),
  };

  return grown ? { ...printed, grown: true } : printed;
}

function printWarning(reported: ReportedWarning): PrintedCycle | OtherFinding {
  if (reported.type === "cycle") {
    return {
      id: "cycle",
      principle: reported.value.principle,
      fix_pattern: reported.value.fixPattern,
      summary: reported.value.summary,
      evidence: {
        modules: [...reported.value.files],
        edges: reported.value.dependencies.map(({ from, to }) => ({
          from,
          to,
        })),
      },
    };
  }

  return otherFindingOf(reported.value);
}

function otherFindingOf(record: Finding): OtherFinding {
  return {
    id: record.kind,
    principle: record.principle,
    fix_pattern: record.fixPattern,
    summary: record.summary,
    evidence: findingRecordOf(record).evidence,
  };
}

function printRanked(result: Ranked) {
  const printOne = (one: ReportedViolation) =>
    one.type === "violation" ? printViolation(one.value) : one.value;

  return {
    violations: result.violations.map(printOne),
    new: result.new.map(printOne),
    fixed: result.fixed,
  };
}

interface Candidate {
  entries: BaselineEntry[];
  keys: string[];
  value: ReportedViolation;
}

interface Ranked {
  violations: ReportedViolation[];
  new: ReportedViolation[];
  fixed: BaselineEntry[];
}

interface SensorStatus {
  name: string;
  status: "ran" | "partial" | "off" | "failed" | "stale" | "missing";
  reason?: string;
  not_measured?: string[];
  settings?: StructureSettings;
  reported?: true;
  out_of_date?: number;
}

interface Gathered {
  documents: SensorFindings[];
  metrics: ModuleMetrics[];
  folderMetrics: FolderMetrics[];
  sensors: SensorStatus[];
  hiddenKeys: Set<string>;
}

function readInput(io: Io, path: string, what: string): string {
  try {
    return io.readFile(path);
  } catch {
    throw new InputError([`cannot read ${what} file: ${path}`]);
  }
}

function ruleLine({ violation, grown }: GrownViolation): string {
  const imports = violation.dependencies
    .map((one) => `${one.to} (${one.kind}) line ${one.lines.join(", ")}`)
    .join("; ");
  const grew = grown ? " (grew an existing violation)" : "";

  return `${violation.file}: ${ruleText(violation.rule)} - ${imports}${grew}`;
}

const TEST_FILE_LINES_SHOWN = 10;

function testFileLines(warning: ReportedWarning): string[] {
  const importers =
    warning.type === "finding" && warning.value.kind === "orphan"
      ? warning.value.testImporters
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
    violation.type === "violation"
      ? ruleLine(violation.value)
      : `${violation.value.summary} (${violation.value.id})`,
  );

  if (result) {
    lines.push(
      `violations: ${result.violations.length}, new: ${result.new.length}, fixed: ${result.fixed.length}`,
    );

    if (result.fixed.length > 0) {
      lines.push("run with --update-baseline to shrink the baseline");
    }
  }

  lines.push(`warnings: ${warnings.length}`);

  if (listWarnings) {
    for (const warning of warnings) {
      lines.push(
        `warning: ${warning.value.summary}`,
        ...testFileLines(warning),
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

function violationOf(sensor: string, record: Finding): Candidate {
  const edges = record.dependencies ?? [];
  const rule = edges[0]?.rules?.[0];

  if (
    sensor === "structure" &&
    record.kind === "rule-violation" &&
    rule !== undefined &&
    edges.every((edge) => edge.kind !== undefined && edge.lines !== undefined)
  ) {
    const from = (edges[0] as { from: string }).from;
    const entries: Identity[] = edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      kind: edge.kind as string,
    }));

    return {
      entries,
      keys: entries.map(identityKey),
      value: {
        type: "violation",
        value: {
          violation: new Violation({
            file: from,
            rule,
            dependencies: edges.map((edge) => ({
              to: edge.to,
              kind: edge.kind as string,
              lines: [...new Set(edge.lines as number[])].sort((a, b) => a - b),
            })),
          }),
          grown: false,
        },
      },
    };
  }

  return {
    entries: [{ id: record.id }],
    keys: [identityKey({ id: record.id })],
    value: {
      type: "other",
      value: { ...otherFindingOf(record), finding_id: record.id },
    },
  };
}

function warningOf(sensor: string, record: Finding): ReportedWarning {
  if (sensor === "structure" && record.kind === "cycle") {
    return {
      type: "cycle",
      value: {
        kind: "cycle",
        principle: "levelization",
        fixPattern: "break-cycle",
        summary: record.summary,
        files: [...record.files],
        dependencies: (record.dependencies ?? []).map(({ from, to }) => ({
          from,
          to,
        })),
      },
    };
  }

  return { type: "finding", value: record };
}

function candidatesOf(documents: SensorFindings[]): Candidate[] {
  return documents.flatMap((document) =>
    document.findings
      .filter((record) => record.severity === "violation")
      .map((record) => violationOf(document.sensor.name, record)),
  );
}

function warningsOf(documents: SensorFindings[]): ReportedWarning[] {
  return documents.flatMap((document) =>
    orderDuplication(document.findings)
      .filter((record) => record.severity === "warning")
      .map((record) => warningOf(document.sensor.name, record)),
  );
}

function rankCandidates(
  candidates: Candidate[],
  baseline: BaselineEntry[] | null,
): Ranked {
  const ranking: Ranking<Candidate> = rankByKeys(candidates, baseline);

  return {
    violations: candidates.map((one) => one.value),
    new: ranking.new.map(({ candidate, fresh, grown }) => {
      const reported = candidate.value;

      if (reported.type === "other") {
        return reported;
      }

      const { violation } = reported.value;

      return {
        type: "violation",
        value: {
          violation: violation.narrowedTo((_, index) =>
            fresh.has(candidate.keys[index] as string),
          ),
          grown,
        },
      };
    }),
    fixed: ranking.fixed,
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
  baselines: BaselineRepository,
  flags: BaselineFlags,
  baselinePath: string,
  candidates: Candidate[],
  hiddenKeys: Set<string> = new Set(),
): {
  result: Ranked;
  report: { path: string; present: boolean; action: BaselineAction };
} {
  const present = baselines.exists(baselinePath);
  const baseline = present ? baselines.read(baselinePath) : null;

  if (flags.init && present) {
    throw new InputError([`baseline already exists: ${baselinePath}`]);
  }

  if (flags.update && !present) {
    throw new InputError([`baseline does not exist: ${baselinePath}`]);
  }

  let result = rankCandidates(candidates, baseline);

  result = {
    ...result,
    fixed: result.fixed.filter((entry) => !hiddenKeys.has(identityKey(entry))),
  };

  let action: BaselineAction = "none";

  if (flags.init) {
    const written = new Map<string, BaselineEntry>();

    for (const one of candidates) {
      for (const [index, entry] of one.entries.entries()) {
        written.set(one.keys[index] as string, entry);
      }
    }

    const entries = [...written.values()];

    baselines.write(baselinePath, entries);
    result = rankCandidates(candidates, entries);
    action = "initialised";
  } else if (
    flags.update &&
    result.new.length === 0 &&
    result.fixed.length > 0
  ) {
    const fixedKeys = new Set(result.fixed.map(identityKey));
    const kept = (baseline ?? []).filter(
      (entry) => !fixedKeys.has(identityKey(entry)),
    );
    baselines.write(baselinePath, kept);
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
    warnings: warnings.map(printWarning),
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

  if (policy !== null) {
    warnPolicyProblems(
      io.stderr,
      values.policy as string,
      readScanFile(scan),
      policy,
    );
  }

  const settings: StructureSettings = {
    duplication: false,
    entry_points: [],
    entry_annotations: [],
    warnings: {
      cycle: true,
      orphan: true,
      unused_exports: false,
      private_imports: true,
      long_function: true,
      complexity: true,
    },
    long_function_limit: LONG_FUNCTION,
    complexity_limit: COMPLEXITY_LIMIT,
  };
  const sensed = structureSensor(readScanFile(scan), policy, settings, {
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
    new BaselineAdapter(io),
    flags,
    baselinePath,
    candidatesOf([sensed.document]),
  );

  io.stdout(
    `${JSON.stringify({ ...printRanked(result), baseline: report, ...analysisReport(warnings, sensed.metrics, sensed.folder_metrics) }, null, 2)}\n`,
  );
  io.stderr(summary(result, warnings));

  return result.new.length > 0 ? 1 : 0;
}

function violationModules(value: ReportedViolation): string[] {
  if (value.type === "violation") {
    const { violation } = value.value;

    return [violation.file, ...violation.dependencies.map((one) => one.to)];
  }

  return [
    ...value.value.evidence.modules,
    ...(value.value.evidence.edges ?? []).flatMap((edge) => [
      edge.from,
      edge.to,
    ]),
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

function defaultPolicyFile(io: Io, root: string): string | null {
  const file = policyFile(root);

  return io.exists(file) ? file : null;
}

function gather(
  io: Io,
  root: string,
  repository: Repository,
  policy: readonly PolicyRule[] | null,
): Gathered {
  const config = readConfig(io, root, ["sensors"]);
  const { commit } = scansCommit(repository);
  const hiddenKeys = new Set<string>();
  const sensors: SensorStatus[] = [];
  const documents: SensorFindings[] = [];
  const resolved = resolveStructureSettings(config);
  let metrics: ModuleMetrics[] = [];
  let folderMetrics: FolderMetrics[] = [];

  const fail = (name: string, reason: string) => {
    io.remove(findingsFile(root, name));
    io.stderr(`failed ${name}: ${reason}\n`);
    sensors.push({ name, status: "failed", reason });
  };

  if (resolved === "off") {
    io.remove(findingsFile(root, "structure"));
    sensors.push({ name: "structure", status: "off" });
  } else {
    const run = runStructureSensor(io, root, repository, policy, resolved);
    const { sensed } = run;

    metrics = sensed.metrics;
    folderMetrics = sensed.folder_metrics;

    if (run.error !== null) {
      fail("structure", run.error);
    } else {
      if (commit === null) {
        documents.push(sensed.document);
      }

      const notMeasured: string[] = [];

      if (duplicationUnmeasured(sensed.document, resolved)) {
        notMeasured.push("duplication");
        io.stderr(
          "duplication not measured since the last scan: run recognizer scan\n",
        );
      }

      if (complexityUnmeasured(sensed.document, resolved)) {
        notMeasured.push("complexity");
        io.stderr(
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
      ...registeredSensors(config).map(({ name }) => name),
      ...shippedSensorNames(),
    ];

    for (const outcome of readFindingsFiles(
      io,
      root,
      freshnessFor(io, root, repository),
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
            for (const key of violationOf(outcome.name, record).keys) {
              hiddenKeys.add(key);
            }
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
    sensors,
    hiddenKeys,
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
      "--update-baseline and --init-baseline check the whole repository and take no file",
    ]);
  }

  const { repository } = freshScans(io, root, ["sensors"]);
  const known = new Set(moduleNames(repository));
  const unknown = named.filter((id) => !known.has(id));

  if (unknown.length > 0) {
    throw new InputError(unknown.map((id) => `no such file: ${id}`));
  }

  const listed = new Set(named);
  const narrowed = named.length > 0;
  const policy =
    policyFile === null
      ? null
      : parsePolicy(readInput(io, policyFile, "policy"));

  if (policyFile !== null) {
    warnPolicyProblems(io.stderr, policyFile, repository, policy);
  }

  const gathered = gather(io, root, repository, policy);

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
  const unmeasuredNote =
    settings?.not_measured && settings.not_measured.length > 0
      ? ` (not measured: ${settings.not_measured.join(", ")})`
      : "";
  const sensorLine = `sensor structure: ${
    settings?.settings
      ? describeSettings(settings.settings)
      : (settings?.status ?? "off")
  }${unmeasuredNote}\n`;
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
    new BaselineAdapter(io),
    flags,
    baselinePath,
    candidates,
    gathered.hiddenKeys,
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
      }
    : settled.result;

  io.stdout(
    values.json
      ? `${JSON.stringify({ ...printRanked(result), baseline: settled.report, ...analysis, sensors: gathered.sensors }, null, 2)}\n`
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
