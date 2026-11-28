import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkGrammars,
  checkLimits,
  checkPlaceholders,
  type Manifest,
} from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { REPO } from "./helpers.js";

const thresholds = () =>
  ({
    ...JSON.parse(
      readFileSync(
        join(REPO, "schema/manifest-examples/valid/sensor-crap.json"),
        "utf8",
      ),
    ),
    name: "mine",
    metrics: [],
    placeholders: {
      name: { pattern: "^.+$", description: "the name of a test suite" },
      variable: {
        pattern: "^[A-Za-z_][A-Za-z0-9_]*$",
        description: "the name of an environment variable",
      },
      metric: {
        pattern: "^[a-z][a-z0-9_-]*$",
        description: "a metric the sensor reports",
      },
    },
    settings: [
      {
        key: "<metric>",
        type: "enum",
        description: "turns the default threshold of a metric off",
        example: "sensors.mine.coverage off",
        values: ["off"],
      },
      {
        key: "<metric>.above",
        type: "number",
        description:
          "a finding when the metric is above this value; a metric takes above or below, not both",
        example: "sensors.mine.churn.above 20",
        order: 1,
        limit: {
          metric: "<metric>",
          direction: "above",
          severity: "<metric>.severity",
        },
      },
      {
        key: "<metric>.below",
        type: "number",
        description:
          "a finding when the metric is below this value; a metric takes above or below, not both",
        example: "sensors.mine.coverage.below 0.7",
        defaults: {
          coverage: 0.6,
        },
        labels: {
          coverage: "Coverage below",
        },
        units: {
          coverage: "0 to 1",
        },
        order: 2,
        limit: {
          metric: "<metric>",
          direction: "below",
          severity: "<metric>.severity",
        },
      },
      {
        key: "<metric>.severity",
        type: "enum",
        description: "how a finding of the metric is reported; default warning",
        example: "sensors.mine.coverage.severity violation",
        values: ["warning", "violation"],
        defaults: {
          coverage: "warning",
        },
      },
    ],
  }) as Manifest;

describe("checkGrammars", () => {
  const grammarsOf = (manifest: Manifest) =>
    checkGrammars({
      command: "x",
      current: 1,
      run: { started: true, status: 0, stdout: "", stderr: "" },
      leftovers: [],
      document: manifest,
      parsed: true,
      manifest,
    } as never);
  const scanner = () =>
    JSON.parse(
      readFileSync(
        join(REPO, "schema/manifest-examples/valid/scanner.json"),
        "utf8",
      ),
    ) as Manifest;
  const withGrammar = (grammar: Record<string, unknown>) => {
    const manifest = scanner();

    manifest.languages = [{ name: "acme", grammars: [grammar] }];

    return manifest;
  };

  it("fails a grammar with no vocabulary, naming the grammar", () => {
    const outcome = grammarsOf(withGrammar({ name: "acme-grammar" }));

    expect(outcome.status).toBe("fail");
    expect(outcome.reason).toContain("acme-grammar");
    expect(outcome.reason).toContain("no vocabulary");
  });

  it("passes a grammar that publishes a vocabulary", () => {
    expect(
      grammarsOf(
        withGrammar({ name: "acme-grammar", vocabulary: { fields: {} } }),
      ),
    ).toEqual({ name: "grammars", status: "ok" });
  });

  it("fails a grammar whose vocabulary has no fields key", () => {
    const outcome = grammarsOf(
      withGrammar({ name: "python", vocabulary: { comment_markers: ["x"] } }),
    );

    expect(outcome.status).toBe("fail");
    expect(outcome.reason).toContain("python");
    expect(outcome.reason).toContain("fields");
  });

  it("passes a grammar that publishes a fields role", () => {
    expect(
      grammarsOf(
        withGrammar({
          name: "python",
          vocabulary: { fields: { name: "name" } },
        }),
      ),
    ).toEqual({ name: "grammars", status: "ok" });
  });

  it("passes a grammar whose empty fields object declares no field carries a role", () => {
    expect(
      grammarsOf(withGrammar({ name: "kotlin", vocabulary: { fields: {} } })),
    ).toEqual({ name: "grammars", status: "ok" });
  });

  it("passes a manifest that publishes no grammars", () => {
    const manifest = scanner();

    manifest.languages = [{ name: "acme" }];

    expect(grammarsOf(manifest)).toEqual({ name: "grammars", status: "ok" });
  });
});

describe("checkLimits", () => {
  const limitsOf = (manifest: Manifest) =>
    checkLimits({
      command: "x",
      current: 1,
      run: { started: true, status: 0, stdout: "", stderr: "" },
      leftovers: [],
      document: manifest,
      parsed: true,
      manifest,
    } as never);
  const edited = (change: (manifest: Manifest) => void) => {
    const manifest = thresholds();

    change(manifest);

    return limitsOf(manifest);
  };
  const first = (manifest: Manifest) =>
    manifest.settings[1] as {
      limit: { metric: string; severity?: string };
      labels?: unknown;
      key: string;
    };

  it("passes the thresholds manifest", () => {
    expect(limitsOf(thresholds())).toEqual({ name: "limits", status: "ok" });
  });

  it("fails a limit on a non-sensor", () => {
    const manifest = JSON.parse(
      readFileSync(
        join(REPO, "schema/manifest-examples/valid/scanner.json"),
        "utf8",
      ),
    ) as Manifest;

    manifest.settings = [
      {
        key: "k",
        type: "number",
        description: "d",
        example: "e",
        limit: { metric: "x", direction: "above" },
      },
    ];

    expect(limitsOf(manifest).reason).toContain("only a sensor");
  });

  it("fails a concrete metric that is not a metric of the manifest", () => {
    const outcome = edited((manifest) => {
      first(manifest).limit.metric = "nope";
    });

    expect(outcome.status).toBe("fail");
    expect(outcome.reason).toContain("nope is not a metric");
  });

  it("fails a placeholder metric that is not the key's own placeholder", () => {
    const outcome = edited((manifest) => {
      first(manifest).limit.metric = "<other>";
    });

    expect(outcome.reason).toContain("not the key's own placeholder");
  });

  it("fails a severity that does not name an enum setting", () => {
    const outcome = edited((manifest) => {
      first(manifest).limit.severity = "<metric>.above";
    });

    expect(outcome.reason).toContain("not an enum setting");
  });

  it("fails labels on a key with no placeholder", () => {
    const outcome = edited((manifest) => {
      manifest.settings.push({
        key: "plain",
        type: "number",
        description: "d",
        example: "e",
        labels: { a: "A" },
      });
    });

    expect(outcome.reason).toContain(
      "plain: labels needs a key with a placeholder",
    );
  });
});

describe("checkPlaceholders", () => {
  const placeholdersOf = (manifest: Manifest) =>
    checkPlaceholders({
      command: "x",
      current: 1,
      run: { started: true, status: 0, stdout: "", stderr: "" },
      leftovers: [],
      document: manifest,
      parsed: true,
      manifest,
    } as never);
  const declared = (manifest: Manifest) =>
    manifest.placeholders as Record<
      string,
      { pattern?: string; values?: string[]; description: string }
    >;
  const edited = (change: (manifest: Manifest) => void) => {
    const manifest = thresholds();

    change(manifest);

    return placeholdersOf(manifest);
  };

  it("passes the thresholds manifest with every placeholder declared and used", () => {
    expect(placeholdersOf(thresholds())).toEqual({
      name: "placeholders",
      status: "ok",
    });
  });

  it("fails a pattern that does not compile", () => {
    const outcome = edited((manifest) => {
      declared(manifest).metric = { pattern: "(", description: "broken" };
    });

    expect(outcome.status).toBe("fail");
    expect(outcome.reason).toContain("metric: pattern does not compile");
  });

  it("fails a placeholder a key uses that the manifest does not declare", () => {
    const outcome = edited((manifest) => {
      delete declared(manifest).metric;
    });

    expect(outcome.status).toBe("fail");
    expect(outcome.reason).toContain(
      "<metric>.above: uses the placeholder <metric> that the manifest does not declare",
    );
  });

  it("fails a declaration no key uses", () => {
    const outcome = edited((manifest) => {
      declared(manifest).unused = {
        values: ["a"],
        description: "nothing uses this",
      };

      expect(Object.keys(declared(manifest))).toContain("unused");
    });

    expect(outcome.status).toBe("fail");
    expect(outcome.reason).toContain("unused: declared but no key uses it");
  });

  it("fails a labels entry that does not match the declared pattern", () => {
    const outcome = edited((manifest) => {
      (manifest.settings[2] as { labels: Record<string, string> }).labels = {
        "Not A Metric": "Coverage below",
      };
    });

    expect(outcome.status).toBe("fail");
    expect(outcome.reason).toContain(
      "<metric>.below: labels entry Not A Metric does not match <metric>",
    );
  });

  it("passes a labels entry that matches the declared pattern", () => {
    const manifest = thresholds();

    expect(
      (manifest.settings[2] as { labels: Record<string, string> }).labels,
    ).toEqual({ coverage: "Coverage below" });
    expect(placeholdersOf(manifest)).toEqual({
      name: "placeholders",
      status: "ok",
    });
  });

  it("fails a sensor that publishes settings and labels none of them", () => {
    const outcome = edited((manifest) => {
      for (const setting of manifest.settings as {
        label?: string;
        labels?: unknown;
      }[]) {
        delete setting.label;
        delete setting.labels;
      }
    });

    expect(outcome.status).toBe("fail");
    expect(outcome.reason).toContain(
      "mine: publishes settings but none has a label or labels, so it gets no Settings pane",
    );
  });

  it("passes a sensor that labels one setting and leaves another unlabelled", () => {
    const manifest = thresholds();

    expect(
      (manifest.settings as { label?: string; labels?: unknown }[]).some(
        (setting) =>
          setting.label === undefined && setting.labels === undefined,
      ),
    ).toBe(true);
    expect(placeholdersOf(manifest)).toEqual({
      name: "placeholders",
      status: "ok",
    });
  });

  it("matches an entry against a values declaration exactly", () => {
    const outcome = edited((manifest) => {
      declared(manifest).metric = {
        values: ["churn"],
        description: "a metric the sensor reports",
      };
    });

    expect(outcome.reason).toContain(
      "<metric>.below: labels entry coverage does not match <metric>",
    );
  });
});

describe("checkPlaceholders choices_by", () => {
  const withChoicesBy = (choicesBy: Record<string, unknown>) => {
    const manifest = thresholds();
    const suite = manifest.suite_keys as { keys: Record<string, unknown>[] };

    suite.keys = [
      {
        key: "tests.<name>.language",
        type: "enum",
        description: "the language",
        example: "tests.unit.language a",
        values: ["a", "b"],
      },
      {
        key: "tests.<name>.runner",
        type: "enum",
        description: "the runner",
        example: "tests.unit.runner x",
        values: ["x", "y"],
        choices_by: choicesBy,
      },
      {
        key: "tests.<name>.env.<variable>",
        type: "string",
        description: "one variable",
        example: "tests.unit.env.A b",
      },
    ];

    return manifest;
  };
  const placeholdersOf = (manifest: Manifest) =>
    checkPlaceholders({
      command: "x",
      current: 1,
      run: { started: true, status: 0, stdout: "", stderr: "" },
      leftovers: [],
      document: manifest,
      parsed: true,
      manifest,
    } as never);

  it("passes a choices_by on a key of the manifest with options among the values", () => {
    expect(
      placeholdersOf(
        withChoicesBy({
          key: "tests.<name>.language",
          choices: { a: [], b: ["x", "y"] },
        }),
      ),
    ).toEqual({ name: "placeholders", status: "ok" });
  });

  it("fails a choices_by whose key is not a key of the manifest", () => {
    const outcome = placeholdersOf(
      withChoicesBy({ key: "tests.<name>.missing", choices: { a: [] } }),
    );

    expect(outcome.status).toBe("fail");
    expect(outcome.reason).toContain("tests.<name>.missing");
  });

  it("fails a choices_by option outside the setting's values", () => {
    const outcome = placeholdersOf(
      withChoicesBy({ key: "tests.<name>.language", choices: { a: ["z"] } }),
    );

    expect(outcome.status).toBe("fail");
    expect(outcome.reason).toContain("option z");
  });

  it("fails a choices_by on a setting that is not an enum", () => {
    const manifest = withChoicesBy({
      key: "tests.<name>.language",
      choices: { a: [] },
    });
    const keys = (manifest.suite_keys as { keys: Record<string, unknown>[] })
      .keys;

    keys[1] = { ...keys[1], type: "string" };

    const outcome = placeholdersOf(manifest);

    expect(outcome.status).toBe("fail");
    expect(outcome.reason).toContain("only on an enum");
  });
});
