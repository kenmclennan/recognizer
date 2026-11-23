import type { Finding, SensorFindings } from "@recognizer/core";
import { readSensorFindings, sensorFindingsDocument } from "recognizer";

export type FindingsLiteral = {
  [key: string]: unknown;
  findings: { [key: string]: unknown }[];
};

export function sensorFindingsFrom(document: FindingsLiteral): SensorFindings {
  return readSensorFindings(document);
}

export type FindingLiteral = { [key: string]: unknown };

export function findingFrom(record: FindingLiteral): Finding {
  const [finding] = readSensorFindings({
    findings_version: 1,
    sensor: { name: "s", version: "1" },
    commit: "c",
    modified: false,
    settings: {},
    findings: [record],
  }).findings;

  return finding as Finding;
}

export function documentText(findings: SensorFindings): string {
  return JSON.stringify(sensorFindingsDocument(findings));
}
