import { join } from "node:path";
import {
  documentFreshness,
  measuredFiles,
  Repository,
  type SensorFindingsHeader,
  splitDocument,
  suiteStandings,
} from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { policyFile } from "../src/config.js";
import { readFindingsText } from "../src/document-text.js";
import { readCachedRepository } from "../src/scan-facts.js";
import { readPolicy } from "../src/serve/inputs-ops.js";
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
    expect(held.measured).toBeNull();
    await root.close();
  });
});

describe("results.read answers the files each document measured", () => {
  it("narrows the structure sensor by the repository policy and carries the core answer", async () => {
    const { root, repository } = typescriptScenario({ sensors: ["crap"] });
    const started = await root.call("scan.start", {
      repository,
      describe: false,
      analysis: false,
      sense: [],
    });

    await root.outcome(started.ok);

    const structure = readCachedRepository(
      root.io,
      repository,
      "typescript",
    ) as Repository;
    const paths = structure.files.map((file) => file.path);
    const ignored = paths[0] as string;

    expect(paths.length).toBeGreaterThan(1);

    const text = JSON.stringify({
      ...JSON.parse(
        realText(
          join(REPO, "schema", "findings-examples", "valid", "crap.json"),
        ),
      ),
      sensor: { name: "structure", version: "1" },
      inputs: Object.fromEntries(structure.scannedHashes()),
    });
    const policyText = `ignore: ["${ignored}"]\n`;
    root.io.files.writeFile(
      `${repository}/.recognizer/cache/findings/structure.json`,
      text,
    );
    root.io.files.writeFile(policyFile(repository), policyText);

    const held = (await root.call("results.read", { repository })).ok.plugins
      .structure;
    const expected = measuredFiles(
      structure,
      readPolicy(root.io, repository),
      "structure",
      held.freshness,
    );

    expect(held.measured).toEqual(expected);
    expect(held.measured).not.toContain(ignored);
    expect(held.measured.length).toBeGreaterThan(0);
    await root.close();
  });
});

describe("results.read answers each plugin's suite standings", () => {
  const write = (
    root: ReturnType<typeof typescriptScenario>["root"],
    repository: string,
    name: string,
    text: string,
  ) => {
    root.io.files.writeFile(
      `${repository}/.recognizer/cache/findings/${name}.json`,
      text,
    );
  };

  it("gives suites equal to suiteStandings over the stored document, and null for a document without suites", async () => {
    const { root, repository } = typescriptScenario({
      sensors: ["crap", "mutation"],
    });

    const crapText = realText(
      join(REPO, "schema", "findings-examples", "valid", "suites.json"),
    );

    write(root, repository, "crap", crapText);
    write(
      root,
      repository,
      "mutation",
      realText(
        join(REPO, "schema", "findings-examples", "valid", "mutation.json"),
      ),
    );

    const plugins = (await root.call("results.read", { repository })).ok
      .plugins;
    const header = plugins.crap.findings as SensorFindingsHeader;
    const stored = readFindingsText(crapText, "crap");

    expect(stored.suites?.length).toBeGreaterThan(0);
    expect(plugins.crap.suites).toEqual(suiteStandings(stored.suites));
    expect(Object.hasOwn(header, "suites")).toBe(false);
    expect(header.sensor).toEqual(stored.sensor);
    expect(header.commit).toBe(stored.commit);
    expect(plugins.mutation.findings).not.toBeNull();
    expect(plugins.mutation.suites).toBeNull();
    await root.close();
  });

  it("gives suites as null for a plugin with an unreadable findings file", async () => {
    const { root, repository } = typescriptScenario({ sensors: ["crap"] });

    write(root, repository, "crap", "not json");

    const held = (await root.call("results.read", { repository })).ok.plugins
      .crap;

    expect(held.findings).toBeNull();
    expect(held.suites).toBeNull();
    await root.close();
  });
});
