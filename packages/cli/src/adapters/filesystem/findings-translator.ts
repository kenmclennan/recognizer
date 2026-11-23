import type {
  Finding,
  FindingDependency,
  FindingMember,
  FindingRule,
  SensorDiagnosis,
  SensorFindings,
} from "@recognizer/core";
import {
  type ExpectedSensor,
  validateFindings,
} from "../../findings-document.js";
import type { Rule } from "../../rules.js";
import type {
  DocumentDiagnosis,
  DocumentEdge,
  DocumentFindingMember,
  FindingRecord,
  FindingsDocument,
} from "./findings-document-types.js";

function given<K extends string, V>(
  key: K,
  value: V | undefined,
): { [P in K]?: V } {
  return value === undefined ? {} : ({ [key]: value } as { [P in K]?: V });
}

export function findingRuleOf(rule: Rule): FindingRule {
  if (rule.type === "level") {
    return {
      type: "level",
      fromLevel: rule.from_level,
      toLevel: rule.to_level,
    };
  }

  if (rule.type === "uses") {
    return {
      type: "uses",
      fromComponent: rule.from_component,
      toComponent: rule.to_component,
    };
  }

  return { type: "forbid", pattern: rule.pattern };
}

function ruleOfDocument(value: unknown): FindingRule | null {
  const rule = value as Partial<Rule> & { type?: string };

  if (rule.type === "level" || rule.type === "uses" || rule.type === "forbid") {
    return findingRuleOf(rule as Rule);
  }

  return null;
}

function dependencyOf(edge: DocumentEdge): FindingDependency {
  const rules =
    edge.rules === undefined
      ? undefined
      : edge.rules
          .map(ruleOfDocument)
          .filter((rule): rule is FindingRule => rule !== null);

  return {
    from: edge.from,
    to: edge.to,
    ...given("kind", edge.kind),
    ...given("lines", edge.lines),
    ...given("rules", rules),
  };
}

function memberOf(member: DocumentFindingMember): FindingMember {
  return {
    file: member.module,
    name: member.name,
    ...given("sourceFile", member.file),
    ...given("lines", member.lines),
    ...given("testFiles", member.test_files),
  };
}

function findingOf(record: FindingRecord): Finding {
  const { evidence } = record;

  return {
    id: record.id,
    kind: record.kind,
    severity: record.severity,
    principle: record.principle,
    ...given("citation", record.citation),
    summary: record.summary,
    ...given("fixPattern", record.fix_pattern),
    ...given("metric", record.metric),
    files: evidence.modules,
    ...given("dependencies", evidence.edges?.map(dependencyOf)),
    ...given("members", evidence.members?.map(memberOf)),
    ...given("measures", evidence.measures),
    ...given("testImporters", evidence.test_importers),
    ...given("producer", evidence.producer),
  };
}

export function policyRuleOf(rule: FindingRule): Rule {
  if (rule.type === "level") {
    return {
      type: "level",
      from_level: rule.fromLevel,
      to_level: rule.toLevel,
    };
  }

  if (rule.type === "uses") {
    return {
      type: "uses",
      from_component: rule.fromComponent,
      to_component: rule.toComponent,
    };
  }

  return { type: "forbid", pattern: rule.pattern };
}

export function findingRecordOf(finding: Finding): FindingRecord {
  const edges = finding.dependencies?.map(
    (dependency): DocumentEdge => ({
      from: dependency.from,
      to: dependency.to,
      ...given("kind", dependency.kind),
      ...given("lines", dependency.lines && [...dependency.lines]),
      ...given("rules", dependency.rules?.map(policyRuleOf)),
    }),
  );
  const members = finding.members?.map(
    (member): DocumentFindingMember => ({
      module: member.file,
      name: member.name,
      ...given("file", member.sourceFile),
      ...given(
        "lines",
        member.lines && ([...member.lines] as [number, number]),
      ),
      ...given("test_files", member.testFiles && [...member.testFiles]),
    }),
  );

  return {
    id: finding.id,
    kind: finding.kind,
    severity: finding.severity,
    principle: finding.principle,
    ...given("citation", finding.citation && { ...finding.citation }),
    summary: finding.summary,
    ...given("fix_pattern", finding.fixPattern),
    ...given("metric", finding.metric),
    evidence: {
      modules: [...finding.files],
      ...given("edges", edges),
      ...given("members", members),
      ...given("measures", finding.measures && { ...finding.measures }),
      ...given(
        "test_importers",
        finding.testImporters?.map((one) => ({
          file: one.file,
          names: [...one.names],
        })),
      ),
      ...given("producer", finding.producer),
    },
  };
}

export function sensorFindingsOf(document: FindingsDocument): SensorFindings {
  return {
    sensor: document.sensor,
    commit: document.commit,
    modified: document.modified,
    settings: document.settings,
    ...given("reportedAt", document.reported_at),
    ...given("stopped", document.stopped),
    ...given("partial", document.partial),
    ...given("counts", document.counts),
    ...given(
      "excluded",
      document.excluded && {
        functions: document.excluded.functions,
        files: document.excluded.modules,
      },
    ),
    ...given(
      "unowned",
      document.unowned && {
        functions: document.unowned.functions,
        files: document.unowned.modules,
      },
    ),
    findings: document.findings.map(findingOf),
    ...given("inputs", document.inputs),
    ...given("tests", document.tests),
    ...given(
      "suites",
      document.suites?.map(({ ran_at, ...rest }) => ({
        ...rest,
        ranAt: ran_at,
      })),
    ),
    ...given("work", document.work),
    ...given("diagnosis", document.diagnosis),
  };
}

export function readSensorFindings(
  value: unknown,
  expected: ExpectedSensor = {},
): SensorFindings {
  return sensorFindingsOf(validateFindings(value, expected));
}

function diagnosisDocumentOf(diagnosis: SensorDiagnosis): DocumentDiagnosis {
  const { failing, ...rest } = diagnosis;

  return {
    ...rest,
    ...(failing === undefined
      ? {}
      : { failing: { ...failing, names: [...failing.names] } }),
  };
}

export function sensorFindingsDocument(
  findings: SensorFindings,
): FindingsDocument {
  return {
    findings_version: findings.inputs === undefined ? 1 : 2,
    sensor: { ...findings.sensor },
    commit: findings.commit,
    modified: findings.modified,
    settings: { ...findings.settings },
    ...given("reported_at", findings.reportedAt),
    ...given("stopped", findings.stopped && { ...findings.stopped }),
    ...given("partial", findings.partial && { ...findings.partial }),
    ...given("counts", findings.counts && { ...findings.counts }),
    ...given(
      "excluded",
      findings.excluded && {
        functions: findings.excluded.functions,
        modules: [...findings.excluded.files],
      },
    ),
    ...given(
      "unowned",
      findings.unowned && {
        functions: findings.unowned.functions,
        modules: [...findings.unowned.files],
      },
    ),
    findings: findings.findings.map(findingRecordOf),
    ...given("inputs", findings.inputs && { ...findings.inputs }),
    ...given("tests", findings.tests),
    ...given(
      "suites",
      findings.suites?.map(({ ranAt, ...rest }) => ({
        ...rest,
        ran_at: ranAt,
      })),
    ),
    ...given("work", findings.work && { ...findings.work }),
    ...given(
      "diagnosis",
      findings.diagnosis && diagnosisDocumentOf(findings.diagnosis),
    ),
  };
}

export interface ReportedFindings {
  name: string;
  version: string;
  commit: string;
  modified: boolean;
  reportedAt: string;
  findings: unknown;
  inputs: Record<string, string>;
}

export function sensorFindingsOfReport(
  report: ReportedFindings,
): SensorFindings {
  return readSensorFindings(
    {
      findings_version: 2,
      sensor: { name: report.name, version: report.version },
      commit: report.commit,
      modified: report.modified,
      settings: {},
      reported_at: report.reportedAt,
      findings: report.findings,
      inputs: report.inputs,
    },
    { name: report.name },
  );
}
