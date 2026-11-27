import { join } from "node:path";
import { documentFreshness, Repository, splitDocument } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { readFindingsText } from "../src/document-text.js";
import { typescriptScenario } from "./support/index.js";
import { realText } from "./support/serve-state-programs.js";

const REPO = join(__dirname, "../../..");
const TESTS = "digest";

function ids(findings: { id: string }[]): string[] {
  return findings.map((finding) => finding.id);
}

describe("results.read answers each document's freshness and split", () => {
  it("gives stale, shown and hidden that equal the core answers over the same inputs", async () => {
    const { root, repository } = typescriptScenario({ sensors: ["crap"] });

    const text = realText(
      join(REPO, "schema", "findings-examples", "valid", "crap.json"),
    );

    root.io.files.writeFile(
      `${repository}/.recognizer/cache/findings/crap.json`,
      text,
    );

    const read = (await root.call("results.read", { repository, tests: TESTS }))
      .ok;
    const held = read.plugins.crap;
    const document = readFindingsText(text, "crap");
    const measured = {
      ...(document.inputs === undefined ? {} : { inputs: document.inputs }),
      ...(document.tests === undefined ? {} : { tests: document.tests }),
    };
    const freshness = documentFreshness(Repository.empty, measured, TESTS);
    const split = splitDocument(Repository.empty, document, TESTS);

    expect(document.findings.length).toBeGreaterThan(0);
    expect(held.freshness).toEqual(freshness);
    expect(held.freshness.stale).toBe(
      !freshness.valid || freshness.outOfDate > 0,
    );
    expect(ids(held.shown)).toEqual(ids(split.shown));
    expect(ids(held.hidden)).toEqual(ids(split.hidden));
    expect(held.shown.length + held.hidden.length).toBe(
      document.findings.length,
    );
    await root.close();
  });

  it("answers the findings header without its records, each record once", async () => {
    const { root, repository } = typescriptScenario({ sensors: ["crap"] });
    const text = realText(
      join(REPO, "schema", "findings-examples", "valid", "crap.json"),
    );
    const stored = readFindingsText(text, "crap");

    root.io.files.writeFile(
      `${repository}/.recognizer/cache/findings/crap.json`,
      text,
    );

    const held = (await root.call("results.read", { repository })).ok.plugins
      .crap;

    expect(stored.findings.length).toBeGreaterThan(0);
    expect(Object.hasOwn(held.findings, "findings")).toBe(false);
    expect(held.findings.sensor).toEqual(stored.sensor);
    expect(held.findings.inputs).toEqual(stored.inputs);
    expect(held.findings.commit).toEqual(stored.commit);
    expect(held.shown.length + held.hidden.length).toBe(stored.findings.length);
    await root.close();
  });

  it("gives shown and hidden as null for a plugin with an unreadable findings file", async () => {
    const { root, repository } = typescriptScenario({ sensors: ["crap"] });

    root.io.files.writeFile(
      `${repository}/.recognizer/cache/findings/crap.json`,
      "not json",
    );

    const held = (await root.call("results.read", { repository })).ok.plugins
      .crap;

    expect(held.findings).toBeNull();
    expect(held.shown).toBeNull();
    expect(held.hidden).toBeNull();
    await root.close();
  });
});
