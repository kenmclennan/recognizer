import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { type Manifest, PluginManifest } from "../../src/index.js";

const REPO = resolve(__dirname, "../../../..");

const example = (file: string): Manifest =>
  JSON.parse(
    readFileSync(resolve(REPO, "schema/manifest-examples/valid", file), "utf8"),
  ) as Manifest;

const SENSE = ["recognizer", "sense", "crap"].join("-");

const sensor = () => example("sensor-crap.json");
const scanner = () => example("scanner.json");

const withSettings = (settings: unknown[], extra: object = {}): Manifest =>
  ({
    ...sensor(),
    metrics: [{ name: "complexity" }],
    suite_keys: undefined,
    settings,
    ...extra,
  }) as Manifest;

describe("PluginManifest", () => {
  it("passes_a_command_named_for_its_kind_and_name", () => {
    expect(
      new PluginManifest(sensor()).namingProblem(`/opt/bin/${SENSE}`),
    ).toBeNull();
  });

  it("names_a_command_that_does_not_match", () => {
    expect(
      new PluginManifest(sensor()).namingProblem(
        `/opt/bin/${["recognizer", "scan", "crap"].join("-")}`,
      ),
    ).toBe(
      `the command is named ${["recognizer", "scan", "crap"].join("-")}, but a sensor called crap must be named ${["recognizer", "sense", "crap"].join("-")}`,
    );
  });

  it("passes_the_current_protocol", () => {
    expect(
      new PluginManifest({ ...sensor(), protocol: 3 }).protocolProblem(3),
    ).toBeNull();
  });

  it("warns_on_the_previous_protocol", () => {
    const manifest = { ...sensor(), protocol: 2 };
    const problem = new PluginManifest(manifest).protocolProblem(3);

    expect(problem).toEqual({
      severity: "warn",
      reason: `crap speaks protocol 2, the previous one (current is 3); upgrade it: ${manifest.install}`,
    });
    expect(
      new PluginManifest({ ...sensor(), protocol: 1 }).protocolProblem(2)
        ?.severity,
    ).toBe("warn");
  });

  it("fails_an_unsupported_protocol", () => {
    const manifest = { ...sensor(), protocol: 1 };

    expect(new PluginManifest(manifest).protocolProblem(3)).toEqual({
      severity: "fail",
      reason: `crap speaks protocol 1, which this recognizer (protocol 3) does not support; fix: ${manifest.install}`,
    });
    expect(
      new PluginManifest({ ...sensor(), protocol: 0 }).protocolProblem(1)
        ?.severity,
    ).toBe("fail");
  });

  it("prefixes_each_sentence_problem_with_its_finding_kind", () => {
    const base = sensor();
    const good = (base.findings ?? [])[0] as NonNullable<
      Manifest["findings"]
    >[number];
    const bad = {
      ...good,
      kind: "broken",
      sentence: {
        requires: [],
        parts: [[{ text: "{evidence.measures.complexity|nope}" }]],
      },
    };
    const problems = new PluginManifest({
      ...base,
      findings: [good, bad],
    } as Manifest).sentenceProblems();

    expect(problems).toHaveLength(1);
    expect(problems[0]).toBe(
      "broken: slot {evidence.measures.complexity|nope} has the unknown format nope",
    );
  });

  it("names_a_grammar_with_no_vocabulary_and_one_with_no_fields", () => {
    const manifest = {
      ...scanner(),
      languages: [
        {
          grammars: [
            { name: "alpha" },
            { name: "beta", vocabulary: {} },
            { name: "gamma", vocabulary: { fields: {} } },
          ],
        },
      ],
    } as unknown as Manifest;
    const problems = new PluginManifest(manifest).grammarProblems();

    expect(problems).toHaveLength(2);
    expect(problems[0]).toBe(
      "grammar alpha publishes no vocabulary, so its comments and literals enter fingerprints and no function shape is trivial",
    );
    expect(problems[1]).toBe(
      "grammar beta publishes no fields declaration, so it is unknown whether a function can be named or operator-based complexity counted",
    );
  });

  it("reports_limit_problems", () => {
    const expectOne = (manifest: Manifest, message: string) => {
      const problems = new PluginManifest(manifest).limitProblems();

      expect(problems).toHaveLength(1);
      expect(problems[0]).toBe(message);
    };

    expectOne(
      withSettings(
        [{ key: "x", type: "number", limit: { metric: "complexity" } }],
        { kind: "scanner" },
      ),
      "x: only a sensor may declare a limit",
    );
    expectOne(
      withSettings([
        {
          key: "x",
          type: "number",
          limit: { metric: "ghost", direction: "above" },
        },
      ]),
      "x: limit metric ghost is not a metric of crap",
    );
    expectOne(
      withSettings([
        {
          key: "<metric>.above",
          type: "number",
          limit: { metric: "<other>", direction: "above" },
        },
      ]),
      "<metric>.above: limit metric <other> is not the key's own placeholder",
    );
    expectOne(
      withSettings([
        {
          key: "x",
          type: "number",
          limit: { metric: "complexity", severity: "mode" },
        },
        { key: "mode", type: "number" },
      ]),
      "x: limit severity mode is not an enum setting of crap",
    );
    expectOne(
      withSettings([{ key: "plain", type: "number", labels: {} }]),
      "plain: labels needs a key with a placeholder",
    );
  });

  it("reports_placeholder_problems", () => {
    const expectOne = (manifest: Manifest, message: string) => {
      const problems = new PluginManifest(manifest).placeholderProblems();

      expect(problems).toHaveLength(1);
      expect(problems[0]).toBe(message);
    };
    const labelled = { key: "<name>.above", type: "number", label: "L" };

    expectOne(
      withSettings([labelled], {
        placeholders: { name: { pattern: "(", description: "d" } },
        suite_keys: undefined,
      }),
      "name: pattern does not compile",
    );
    expectOne(
      withSettings([labelled], { placeholders: {} }),
      "<name>.above: uses the placeholder <name> that the manifest does not declare",
    );
    expectOne(
      withSettings([{ key: "plain", type: "number", label: "L" }], {
        placeholders: { name: { pattern: "^.+$", description: "d" } },
      }),
      "name: declared but no key uses it",
    );
    expectOne(
      withSettings([{ key: "plain", type: "number" }], {
        placeholders: {},
      }),
      "crap: publishes settings but none has a label or labels, so it gets no Settings pane",
    );
    expectOne(
      withSettings([{ ...labelled, labels: { "bad value": "x" } }], {
        placeholders: { name: { values: ["ok"], description: "d" } },
      }),
      "<name>.above: labels entry bad value does not match <name>",
    );
  });

  it("reports_nothing_for_the_committed_sensor_example", () => {
    const manifest = new PluginManifest(sensor());

    expect(manifest.sentenceProblems()).toEqual([]);
    expect(manifest.grammarProblems()).toEqual([]);
    expect(manifest.limitProblems()).toEqual([]);
    expect(manifest.placeholderProblems()).toEqual([]);
    expect(manifest.namingProblem(SENSE)).toBeNull();
  });
});
