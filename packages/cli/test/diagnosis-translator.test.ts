import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  diagnosisDocumentOf,
  diagnosisOf,
  readDiagnosis,
} from "../src/index.js";
import { REPO } from "./helpers.js";

const FINDINGS = join(REPO, "schema/findings-examples");
const LOG = join(REPO, "schema/log-examples/valid");

function read(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8"));
}

function logDiagnoses(record: Record<string, unknown>): unknown[] {
  const entries = [
    ...((record.entries as Record<string, unknown>[] | undefined) ?? []),
    ...(
      (record.phases as { entries: Record<string, unknown>[] }[]) ?? []
    ).flatMap((phase) => phase.entries),
  ];

  return entries.flatMap((one) =>
    one.diagnosis === undefined ? [] : [one.diagnosis],
  );
}

describe("diagnosis translator", () => {
  it("round-trips every committed valid diagnosis example unchanged", () => {
    const documents = [
      "diagnosis.json",
      "diagnosis-custom-code.json",
      "diagnosis-unmeasured.json",
    ].map((file) => read(join(FINDINGS, "valid", file)).diagnosis);

    documents.push(
      ...logDiagnoses(read(join(LOG, "measure-diagnosis.json"))),
      ...logDiagnoses(read(join(LOG, "scan-phases-sense-failed.json"))),
    );

    expect(documents.length).toBeGreaterThanOrEqual(5);

    for (const document of documents) {
      expect(document).toBeDefined();
      expect(diagnosisDocumentOf(diagnosisOf(document as never))).toStrictEqual(
        document,
      );
    }
  });

  it("reads the valid findings diagnoses and rejects the empty code and the empty suite", () => {
    const valid = [
      "diagnosis.json",
      "diagnosis-custom-code.json",
      "diagnosis-unmeasured.json",
    ].map((file) =>
      readDiagnosis(read(join(FINDINGS, "valid", file)).diagnosis),
    );

    expect(valid.filter((one) => one === null)).toHaveLength(0);

    const invalid = {
      "diagnosis-empty-code.json": null,
      "diagnosis-suite-empty.json": null,
    };

    for (const [file, expected] of Object.entries(invalid)) {
      expect(
        readDiagnosis(read(join(FINDINGS, "invalid", file)).diagnosis),
      ).toBe(expected);
    }
  });

  it("tolerates the schema's extra key and six names, which the validators own", () => {
    for (const file of [
      "diagnosis-extra-key.json",
      "diagnosis-six-names.json",
    ]) {
      expect(
        readDiagnosis(read(join(FINDINGS, "invalid", file)).diagnosis),
      ).not.toBeNull();
    }
  });

  it("drops a failing count of 0 and keeps the names", () => {
    expect(
      readDiagnosis({
        code: "x",
        line: "y",
        failing: { count: 0, names: ["a"] },
      }),
    ).toStrictEqual({ code: "x", line: "y", failing: { names: ["a"] } });
  });
});
