import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  type BaselineFlags,
  type CheckReport,
  checkRepositoryFresh,
  checkScan,
  describeSettings,
  type Finding,
  type Ranked,
  type ReportedViolation,
  type ReportedWarning,
  refuseBadScanFlags,
  ruleText,
  type SensorStatus,
  type Violation,
} from "@recognizer/core";
import { BaselineAdapter } from "./adapters/filesystem/baseline-adapter.js";
import {
  documentRuleOf,
  findingRecordOf,
} from "./adapters/filesystem/findings-translator.js";
import { PolicyAdapter } from "./adapters/filesystem/policy-adapter.js";
import { readScanFile } from "./adapters/filesystem/scan-translator.js";
import { SensorsAdapter } from "./adapters/plugins/sensors-adapter.js";
import type { Io } from "./cli.js";
import { asInputError, InputError } from "./errors.js";
import type { FolderMetrics } from "./folder-metrics.js";
import { freshPorts } from "./fresh-ports.js";
import { requestFrom } from "./scan-main.js";

type FindingEvidence = ReturnType<typeof findingRecordOf>["evidence"];

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

function printOne(one: ReportedViolation) {
  return one.type === "violation"
    ? printViolation(one.value)
    : { ...otherFindingOf(one.value), finding_id: one.value.id };
}

function printRanked(result: Ranked) {
  return {
    violations: result.violations.map(printOne),
    new: result.new.map(printOne),
    fixed: result.fixed,
  };
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
      : `${violation.value.summary} (${violation.value.kind})`,
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

const OPTIONS = {
  scan: { type: "string" },
  repository: { type: "string" },
  json: { type: "boolean" },
  policy: { type: "string" },
  baseline: { type: "string" },
  "update-baseline": { type: "boolean" },
  "init-baseline": { type: "boolean" },
} as const;

function analysisReport(
  warnings: ReportedWarning[],
  metrics: CheckReport["metrics"],
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

  asInputError(() => refuseBadScanFlags(flags, Boolean(values.policy)));

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

  const rules = values.policy
    ? asInputError(() => new PolicyAdapter(io).rulesAt(values.policy as string))
    : null;
  const baselinePath = values.policy
    ? (values.baseline ??
      join(dirname(values.policy), "baselines", "violations.json"))
    : null;
  const say = (stream: "stdout" | "stderr", text: string) =>
    stream === "stderr" ? io.stderr(text) : io.stdout(text);
  const report = asInputError(() =>
    checkScan(
      { analysis: new SensorsAdapter(io), baselines: new BaselineAdapter(io) },
      say,
      {
        repository: readScanFile(scan),
        rules,
        policyFile: values.policy ?? null,
        baselinePath,
        flags,
      },
    ),
  );
  const analysis = analysisReport(
    report.warnings,
    report.metrics,
    report.folderMetrics,
  );

  if (report.ranked === null) {
    io.stdout(`${JSON.stringify(analysis, null, 2)}\n`);
    io.stderr(summary(null, report.warnings));

    return report.exit;
  }

  io.stdout(
    `${JSON.stringify({ ...printRanked(report.ranked), baseline: report.baseline, ...analysis }, null, 2)}\n`,
  );
  io.stderr(summary(report.ranked, report.warnings));

  return report.exit;
}

function sensorLineOf(sensors: SensorStatus[]): string {
  const settings = sensors.find((one) => one.name === "structure");
  const unmeasuredNote =
    settings?.not_measured && settings.not_measured.length > 0
      ? ` (not measured: ${settings.not_measured.join(", ")})`
      : "";

  return `sensor structure: ${
    settings?.settings
      ? describeSettings(settings.settings)
      : (settings?.status ?? "off")
  }${unmeasuredNote}\n`;
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
  const policyFile = values.policy ?? new PolicyAdapter(io).defaultFile(root);
  const flags: BaselineFlags = {
    baseline: values.baseline,
    update: values["update-baseline"] === true,
    init: values["init-baseline"] === true,
  };
  const baselinePath =
    values.baseline ??
    join(
      policyFile === null ? join(root, ".recognizer") : dirname(policyFile),
      "baselines",
      "violations.json",
    );
  const say = (stream: "stdout" | "stderr", text: string) =>
    stream === "stderr" ? io.stderr(text) : io.stdout(text);
  const report = asInputError(() =>
    checkRepositoryFresh(freshPorts(io, ["sensors"]), say, {
      root,
      policyFile,
      baselinePath,
      flags,
      named,
      scan: requestFrom([root, "--extract"], io).request,
    }),
  );
  const analysis = analysisReport(
    report.warnings,
    report.metrics,
    report.folderMetrics,
  );
  const sensorLine = sensorLineOf(report.sensors);

  if (report.ranked === null) {
    io.stdout(
      values.json
        ? `${JSON.stringify({ ...analysis, sensors: report.sensors }, null, 2)}\n`
        : `${sensorLine}${summary(null, report.warnings, true)}`,
    );

    return report.exit;
  }

  io.stdout(
    values.json
      ? `${JSON.stringify({ ...printRanked(report.ranked), baseline: report.baseline, ...analysis, sensors: report.sensors }, null, 2)}\n`
      : `${sensorLine}${summary(report.ranked, report.warnings, true)}`,
  );

  return report.exit;
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
