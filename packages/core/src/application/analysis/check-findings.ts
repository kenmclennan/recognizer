import type { Finding } from "../../domain/finding.js";
import { orderDuplication } from "../../domain/finding-text.js";
import type { SensorFindings } from "../../domain/sensor-findings.js";
import { Violation } from "../../domain/violation.js";
import { Warning } from "../../domain/warning.js";
import {
  type Candidate,
  type Identity,
  identityKey,
} from "../history/settle-baseline.js";

export type ReportedWarning =
  | { type: "warning"; value: Warning }
  | { type: "finding"; value: Finding };

export function violationOf(sensor: string, record: Finding): Candidate {
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
    value: { type: "other", value: record },
  };
}

export function warningOf(sensor: string, record: Finding): ReportedWarning {
  if (sensor === "structure") {
    const warning = Warning.ofFinding(record);

    if (warning !== null) {
      return { type: "warning", value: warning };
    }
  }

  return { type: "finding", value: record };
}

export function candidatesOf(documents: SensorFindings[]): Candidate[] {
  return documents.flatMap((document) =>
    document.findings
      .filter((record) => record.severity === "violation")
      .map((record) => violationOf(document.sensor.name, record)),
  );
}

export function warningsOf(documents: SensorFindings[]): ReportedWarning[] {
  return documents.flatMap((document) =>
    orderDuplication(document.findings)
      .filter((record) => record.severity === "warning")
      .map((record) => warningOf(document.sensor.name, record)),
  );
}
