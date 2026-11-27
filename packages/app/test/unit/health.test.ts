import {
  Finding,
  identityKey,
  type SensorFindings,
  Violation,
} from "@recognizer/core";
import { InputError, parseBaseline, parsePolicy } from "recognizer";
import { describe, expect, it } from "vitest";
import {
  computeHealth,
  describeTree,
  type Health,
  violationLine,
} from "../../src/health";
import { buildTree } from "../../src/tree-model";
import {
  CURRENT,
  fixtureBaseline,
  fixturePolicy,
  fixtureScan,
  secondSensorDocument,
  structureDocument,
} from "../fixtures";
import { measuredFor, splitFor } from "../freshness-support";
import { type DocScan, repositoryFrom } from "./repository-from";

function parsedOrNull<T>(
  text: string | null,
  parse: (text: string) => T,
): { value: T | null; problem: string | null } {
  if (text === null) {
    return { value: null, problem: null };
  }

  try {
    return { value: parse(text), problem: null };
  } catch (error) {
    return {
      value: null,
      problem:
        error instanceof InputError
          ? [...new Set(error.messages)].join("; ")
          : (error as Error).message,
    };
  }
}

function healthFor(
  name: string,
  policy: string | null,
  findings: SensorFindings[],
  baseline: string | null = null,
  modules?: string[],
) {
  const loaded = fixtureScan(name, "scan.json", CURRENT);
  const ids = modules ?? loaded.repository.files.map((file) => file.path);
  const parsedPolicy = parsedOrNull(policy, parsePolicy);
  const parsedBaseline = parsedOrNull(baseline, (text) =>
    parseBaseline(text).map(identityKey),
  );

  return {
    health: computeHealth({
      repository: loaded.repository,
      policy: parsedPolicy.value,
      modules: ids,
      baseline: parsedBaseline.value,
      baselineProblem: parsedBaseline.problem,
      findings,
      split: splitFor(loaded.repository, findings, null),
      measured: measuredFor(
        loaded.repository,
        findings,
        null,
        parsedPolicy.value,
      ),
    }),
    ids,
  };
}

function healthOf(name: string, policy: string | null) {
  return healthFor(name, policy, [structureDocument(name, policy)]);
}

describe("computeHealth on fixtures/check", () => {
  const { health, ids } = healthOf("check", fixturePolicy("check"));

  it("marks violating files red", () => {
    for (const id of [
      "shop/domain/order.py",
      "shop/domain/money.py",
      "shop/adapters/sql_store.py",
    ]) {
      expect(health.disc(id)).toBe("red");
    }
  });

  it("marks the cycle amber", () => {
    expect(health.disc("shop/application/place.py")).toBe("amber");
  });

  it("marks the other measured files green", () => {
    for (const id of [
      "shop/ports/store.py",
      "shop/adapters/memory_store.py",
      "shop/main.py",
    ]) {
      expect(health.disc(id)).toBe("green");
    }
  });

  it("marks the file in an uncovered folder green, the folder being a policy problem and not a finding", () => {
    expect(health.disc("shop/legacy/helpers.py")).toBe("green");
  });

  it("shows an ignored file as a grey ring", () => {
    expect(health.disc("tests/test_order.py")).toBe("grey");
  });

  it("aggregates folders to the worst inside, grey above green", () => {
    const described = describeTree(buildTree(ids), health);

    expect(described.get("shop/domain")?.disc).toBe("red");
    expect(described.get("shop")?.disc).toBe("red");
    expect(described.get("shop/ports")?.disc).toBe("green");
    expect(described.get("tests")?.disc).toBe("grey");
  });

  it("reports no notices", () => {
    expect(health.notices).toEqual([]);
  });

  it("pins the finding line formats", () => {
    expect(health.lines("shop/domain/order.py")[0]).toMatch(
      /^violation: depends on shop\/adapters\/memory_store\.py at line \d+(, \d+)*; depends on shop\/application\/place\.py at line 7 \(forbid /,
    );
    expect(health.lines("shop/application/place.py")).toHaveLength(1);
    expect(health.lines("shop/application/place.py")[0]).toContain("cycle");
  });

  it("hovers say why, one line per finding", () => {
    const described = describeTree(buildTree(ids), health);

    expect(described.get("shop/main.py")?.hover).toBe("no findings");
    expect(described.get("tests/test_order.py")?.hover).toBe("not measured");
    expect(
      described.get("shop/domain/order.py")?.hover.split("\n").length,
    ).toBe(health.lines("shop/domain/order.py").length);
  });

  it("prefixes a folder hover with each file's path relative to the folder", () => {
    const described = describeTree(buildTree(ids), health);
    const lines = described.get("shop/domain")?.hover.split("\n") ?? [];

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((line) => /^(order|money)\.py: /.test(line))).toBe(true);
  });
});

describe("findings", () => {
  it("returns structured violations before warnings, leaving lines unchanged", () => {
    const { health } = healthOf("check", fixturePolicy("check"));
    const order = health.findings("shop/domain/order.py");

    expect(order.length).toBe(health.lines("shop/domain/order.py").length);
    expect(order[0]?.severity).toBe("violation");
    expect(order[0]?.text).toMatch(
      /^depends on shop\/adapters\/memory_store\.py at line \d+(, \d+)*; depends on shop\/application\/place\.py at line 7$/,
    );
    expect(order[0]?.why).toMatch(/^forbid /);
    expect(health.lines("shop/domain/order.py")[0]).toBe(
      `violation: ${order[0]?.text} (${order[0]?.why})`,
    );
  });

  it("returns a warning with its principle", () => {
    const { health } = healthOf("check", fixturePolicy("check"));
    const place = health.findings("shop/application/place.py");

    expect(place).toHaveLength(1);
    expect(place[0]?.severity).toBe("warning");
    expect(place[0]?.text).toContain("cycle");
    expect(place[0]?.why).toBe("Levelization");
  });

  it("returns nothing for a green or a grey file", () => {
    const { health } = healthOf("check", fixturePolicy("check"));

    expect(health.findings("shop/main.py")).toEqual([]);
    expect(health.findings("tests/test_order.py")).toEqual([]);
  });

  it("covers the check-warnings fixture", () => {
    const { health } = healthOf(
      "check-warnings",
      fixturePolicy("check-warnings"),
    );

    expect(health.findings("app/domain/order.py")[0]?.severity).toBe(
      "violation",
    );
    expect(health.findings("app/domain/money.py")[0]?.severity).toBe("warning");
  });
});

describe("computeHealth on fixtures/check-warnings", () => {
  it("has one red, five amber and three green", () => {
    const { health, ids } = healthOf(
      "check-warnings",
      fixturePolicy("check-warnings"),
    );

    expect(health.disc("app/domain/order.py")).toBe("red");
    expect(health.disc("app/domain/money.py")).toBe("amber");

    for (const orphan of [
      "app/adapters/audit.py",
      "app/adapters/clock.py",
      "app/adapters/sql.py",
      "app/application/report.py",
    ]) {
      expect(health.disc(orphan)).toBe("amber");
    }

    const others = ids.filter((id) => health.disc(id) === "green");

    expect(others).toEqual([
      "app/ports/store.py",
      "app/application/place.py",
      "app/adapters/memory.py",
    ]);
  });
});

describe("computeHealth with a baseline", () => {
  const baseline = fixtureBaseline("check");

  function withBaseline(text: string | null) {
    return healthFor(
      "check",
      fixturePolicy("check"),
      [structureDocument("check", fixturePolicy("check"))],
      text,
    ).health;
  }

  it("does not mark a baselined violation red or list it as a finding", () => {
    const plain = withBaseline(null);
    const health = withBaseline(baseline);

    expect(plain.disc("shop/domain/order.py")).toBe("red");
    expect(plain.findings("shop/domain/order.py")[0]?.text).toContain(
      "memory_store.py",
    );
    expect(health.findings("shop/domain/order.py")[0]?.text).not.toContain(
      "memory_store.py",
    );
  });

  it("leaves a baselined violation and an out-of-date document's findings out of documents", () => {
    const policy = fixturePolicy("check");
    const plain = withBaseline(null);
    const health = withBaseline(baseline);
    const count = (documents: Health["documents"]) =>
      documents.reduce((total, one) => total + one.findings.length, 0);
    const stray = healthFor("check", policy, [
      structureDocument("check", policy),
      secondSensorDocument("shop/main.py", undefined, undefined, "other"),
    ]).health;

    expect(count(health.documents)).toBe(count(plain.documents));
    expect(health.documents).not.toEqual(plain.documents);
    expect(
      stray.documents.find((one) => one.sensor.name === "lint")?.findings,
    ).toEqual([]);
    expect(stray.hidden.map((one) => one.sensor.name)).toEqual(["lint"]);
  });

  it("keeps a violation the baseline does not list", () => {
    const health = withBaseline(
      JSON.stringify({ schema_version: 1, violations: [] }),
    );

    expect(health.disc("shop/domain/order.py")).toBe("red");
  });

  it("notes an unreadable baseline and applies none", () => {
    const health = withBaseline("{");

    expect(health.notices).toHaveLength(1);
    expect(health.notices[0]).toMatch(/^baseline: /);
    expect(health.disc("shop/domain/order.py")).toBe("red");
  });
});

describe("computeHealth narrows a grouped finding by import", () => {
  const policy = fixturePolicy("check");
  const FROM = "shop/domain/order.py";
  const MEMORY = "shop/adapters/memory_store.py";
  const PLACE = "shop/application/place.py";
  const rule = {
    type: "level" as const,
    fromLevel: "domain",
    toLevel: "adapters",
  };
  const edge = (to: string, line: number) => ({
    from: FROM,
    to,
    kind: "depends",
    lines: [line],
    rules: [rule],
  });
  const grouped = Finding.stored({
    id: "rule-violation:level domain -> adapters:shop/domain/order.py",
    kind: "rule-violation",
    severity: "violation",
    principle: "dependency-inversion-principle",
    summary: `depends on ${MEMORY} at line 4; depends on ${PLACE} at line 7`,
    files: [FROM],
    dependencies: [edge(MEMORY, 4), edge(PLACE, 7)],
  });
  const baselineOf = (violations: object[]) =>
    JSON.stringify({ schema_version: 1, violations });
  const visible = (violations: object[], extra: Finding[] = []) => {
    const document = structureDocument("check", policy);

    return healthFor(
      "check",
      policy,
      [{ ...document, findings: [grouped, ...extra] }],
      baselineOf(violations),
    ).health.documents[0]?.findings;
  };

  it("a finding with an accepted import keeps only the new imports", () => {
    const found = visible([{ from: FROM, to: MEMORY, kind: "depends" }]);

    expect(found).toHaveLength(1);
    expect(found?.[0]?.dependencies?.map((one) => one.to)).toEqual([PLACE]);
    expect(found?.[0]?.summary).toBe(`depends on ${PLACE} at line 7`);
  });

  it("a finding whose imports are all accepted is hidden", () => {
    expect(
      visible([
        { from: FROM, to: MEMORY, kind: "depends" },
        { from: FROM, to: PLACE, kind: "depends" },
      ]),
    ).toEqual([]);
  });

  it("a non-structure violation is still accepted by its id", () => {
    const other = Finding.stored({
      id: "lint:1",
      kind: "lint",
      severity: "violation",
      principle: "p",
      summary: "s",
      files: [FROM],
    });

    expect(
      visible([{ id: "lint:1" }], [other])?.some((one) => one.id === "lint:1"),
    ).toBe(false);
    expect(visible([], [other])?.some((one) => one.id === "lint:1")).toBe(true);
  });
});

describe("computeHealth without a policy", () => {
  it("shows nothing red and both cycle files amber", () => {
    const { health, ids } = healthOf("check", null);

    expect(ids.some((id) => health.disc(id) === "red")).toBe(false);
    expect(health.disc("shop/application/place.py")).toBe("amber");
    expect(health.disc("shop/domain/order.py")).toBe("amber");
    expect(health.disc("tests/test_order.py")).toBe("green");
  });

  it("drops a finding on an id that is not a file", () => {
    const modules = fixtureScan("check", "scan.json", CURRENT)
      .repository.files.map((file) => file.path)
      .filter((id) => id !== "shop/domain/order.py");
    const { health } = healthFor(
      "check",
      fixturePolicy("check"),
      [structureDocument("check", fixturePolicy("check"))],
      null,
      modules,
    );

    expect(health.lines("shop/domain/order.py")).toEqual([]);
  });
});

describe("computeHealth from findings files", () => {
  it("measures nothing without a structure file, so every disc is grey", () => {
    const { health, ids } = healthFor("check", fixturePolicy("check"), []);

    expect(ids.every((id) => health.disc(id) === "grey")).toBe(true);
  });

  it("ignores a file from another commit, leaving its files grey", () => {
    const { health, ids } = healthFor("check", fixturePolicy("check"), [
      structureDocument("check", fixturePolicy("check"), "old"),
    ]);

    expect(ids.every((id) => health.disc(id) === "grey")).toBe(true);
    expect(health.findings("shop/domain/order.py")).toEqual([]);
  });

  it("shows a finding from a second sensor with its summary and principle", () => {
    const { health } = healthFor("check", fixturePolicy("check"), [
      structureDocument("check", fixturePolicy("check")),
      secondSensorDocument("shop/main.py"),
    ]);

    expect(health.disc("shop/main.py")).toBe("amber");
    expect(health.findings("shop/main.py")).toEqual([
      {
        severity: "warning",
        text: "too many magic numbers",
        why: "name-your-constants",
      },
    ]);
  });

  it("marks a clean file green when a second sensor's current file covers it, without a structure file", () => {
    const { health } = healthFor("check", fixturePolicy("check"), [
      secondSensorDocument("shop/main.py"),
    ]);

    expect(health.disc("shop/main.py")).toBe("amber");
    expect(health.disc("shop/ports/store.py")).toBe("green");
  });

  it("keeps a file grey when the only current file is a stale second sensor", () => {
    const { health } = healthFor("check", fixturePolicy("check"), [
      secondSensorDocument("shop/main.py", "x", "y", "old"),
    ]);

    expect(health.disc("shop/ports/store.py")).toBe("grey");
  });

  it("ignores a stale second sensor", () => {
    const stale = secondSensorDocument("shop/main.py", "x", "y", "old");
    const { health } = healthFor("check", fixturePolicy("check"), [
      structureDocument("check", fixturePolicy("check")),
      stale,
    ]);

    expect(health.disc("shop/main.py")).toBe("green");
  });
});

describe("hover truncation", () => {
  it("ends with and <n> more after ten findings", () => {
    const ids = Array.from({ length: 12 }, (_, index) => `d/m${index}.py`);
    const health: Health = {
      documents: [],
      hidden: [],
      disc: () => "amber",
      lines: () => ["a finding"],
      findings: () => [],
      notices: [],
      policyProblems: [],
    };
    const hover = describeTree(buildTree(ids), health).get("d")?.hover ?? "";
    const lines = hover.split("\n");

    expect(lines).toHaveLength(11);
    expect(lines[10]).toBe("and 2 more");
  });
});

describe("violationLine", () => {
  const base = { file: "a" };
  const dependencies = (kind: string) => [{ to: "b", kind, lines: [3, 5] }];

  it("names each rule kind", () => {
    expect(
      violationLine(
        new Violation({
          ...base,
          dependencies: dependencies("depends"),
          rule: { type: "level", fromLevel: "domain", toLevel: "adapters" },
        }),
      ),
    ).toBe("violation: depends on b at line 3, 5 (level domain -> adapters)");
    expect(
      violationLine(
        new Violation({
          ...base,
          dependencies: dependencies("inherits"),
          rule: { type: "uses", fromComponent: "x", toComponent: "y" },
        }),
      ),
    ).toBe("violation: inherits b at line 3, 5 (uses x -> y)");
    expect(
      violationLine(
        new Violation({
          ...base,
          dependencies: dependencies("implements"),
          rule: { type: "forbid", pattern: "* -> foreign:requests" },
        }),
      ),
    ).toBe(
      "violation: implements b at line 3, 5 (forbid * -> foreign:requests)",
    );
  });
});

describe("computeHealth judged per file", () => {
  const H1 = "1".repeat(64);
  const H2 = "2".repeat(64);
  const H0 = "0".repeat(64);
  const T = "a".repeat(64);

  const scan = (
    {
      file: "scan.python.json",
      scan: {
        modules: [
          { id: "a.py", kind: "module" },
          { id: "b.py", kind: "module" },
        ],
        edges: [],
        foreign: [],
        files: [
          { path: "a.py", hash: H1 },
          { path: "b.py", hash: H2 },
        ],
      },
    } as unknown as { scan: DocScan }
  ).scan;

  function crap(
    inputs: Record<string, string> | undefined,
    tests: string | undefined = T,
  ): SensorFindings {
    const finding = (id: string, modules: string[]) =>
      Finding.stored({
        id,
        kind: "crap",
        severity: "warning",
        principle: "reduce-risk",
        summary: id,
        files: modules,
      });

    return {
      sensor: { name: "crap", version: "1" },
      commit: "whatever",
      modified: false,
      settings: {},
      findings: [
        finding("on-a", ["a.py"]),
        finding("on-b", ["b.py"]),
        finding("pair", ["a.py", "b.py"]),
      ],
      ...(inputs === undefined ? {} : { inputs }),
      ...(tests === undefined ? {} : { tests }),
    };
  }

  const healthOfDocument = (document: SensorFindings, tests = T) =>
    computeHealth({
      repository: repositoryFrom([scan]),
      policy: null,
      modules: ["a.py", "b.py"],
      baseline: null,
      findings: [document],
      split: splitFor(repositoryFrom([scan]), [document], tests),
      measured: measuredFor(repositoryFrom([scan]), [document], tests),
    });

  it("shows exactly the answered shown list and hides the answered hidden list", () => {
    const document = crap({ "a.py": H1, "b.py": H0 });
    const [first, second, third] = document.findings;

    expect(document.findings.length).toBeGreaterThan(2);

    const health = computeHealth({
      repository: repositoryFrom([scan]),
      policy: null,
      modules: ["a.py", "b.py"],
      baseline: null,
      findings: [document],
      split: {
        crap: {
          shown: [third as Finding],
          hidden: [first as Finding, second as Finding],
        },
      },
      measured: {},
    });

    expect(health.documents[0]?.findings.map((f) => f.id)).toEqual([third?.id]);
    expect(health.hidden[0]?.findings.map((f) => f.id)).toEqual([
      first?.id,
      second?.id,
    ]);
  });

  it("keeps the findings of current files and hides the rest", () => {
    const health = healthOfDocument(crap({ "a.py": H1, "b.py": H0 }));

    expect(health.documents[0]?.findings.map((f) => f.id)).toEqual(["on-a"]);
    expect(health.hidden[0]?.findings.map((f) => f.id)).toEqual([
      "on-b",
      "pair",
    ]);
    expect(health.disc("a.py")).toBe("amber");
    expect(health.disc("b.py")).toBe("grey");
    expect(health.findings("b.py")).toEqual([]);
  });

  it("colours a file covered currently with no current findings green", () => {
    const health = healthOfDocument({
      ...crap({ "a.py": H1, "b.py": H2 }),
      findings: [],
    });

    expect(health.disc("a.py")).toBe("green");
    expect(health.disc("b.py")).toBe("green");
    expect(health.hidden).toEqual([]);
  });

  it("colours green exactly the ids the loaded measured list names", () => {
    const measured = { crap: ["a.py"] };

    expect(Object.values(measured).flat().length).toBeGreaterThan(0);

    const health = computeHealth({
      repository: repositoryFrom([scan]),
      policy: null,
      modules: ["a.py", "b.py"],
      baseline: null,
      findings: [],
      split: {},
      measured,
    });

    expect(health.disc("a.py")).toBe("green");
    expect(health.disc("b.py")).toBe("grey");
  });

  it("leaves every file grey when nothing is listed measured though the inputs match", () => {
    const document = { ...crap({ "a.py": H1, "b.py": H2 }), findings: [] };
    const health = computeHealth({
      repository: repositoryFrom([scan]),
      policy: null,
      modules: ["a.py", "b.py"],
      baseline: null,
      findings: [document],
      split: splitFor(repositoryFrom([scan]), [document], T),
      measured: {},
    });

    expect(health.disc("a.py")).toBe("grey");
    expect(health.disc("b.py")).toBe("grey");
  });

  it("hides everything and leaves its files grey without inputs", () => {
    const health = healthOfDocument(crap(undefined));

    expect(health.documents[0]?.findings).toEqual([]);
    expect(health.hidden[0]?.findings).toHaveLength(3);
    expect(health.disc("a.py")).toBe("grey");
    expect(health.disc("b.py")).toBe("grey");
  });

  it("hides every finding when the tests hash differs though files match", () => {
    const health = healthOfDocument(
      crap({ "a.py": H1, "b.py": H2 }),
      "b".repeat(64),
    );

    expect(health.documents[0]?.findings).toEqual([]);
    expect(health.hidden[0]?.findings).toHaveLength(3);
    expect(health.disc("a.py")).toBe("grey");
  });
});

describe("computeHealth policy problems", () => {
  const problemsFor = (policy: string | null) =>
    healthFor("check", policy, []).health.policyProblems;

  it("reports no problem for the committed fixtures/check policy and marks no file", () => {
    const policy = fixturePolicy("check");
    const { health, ids } = healthOf("check", policy);

    expect(health.policyProblems).toEqual([]);

    for (const id of ids) {
      expect(health.lines(id).join("\n")).not.toContain("matches no scanned");
    }
  });

  it("reports an entry glob that matches no scanned file", () => {
    const problems = problemsFor("entry:\n  - shop/main.py\n  - nowhere/**\n");

    expect(problems).toEqual([
      {
        kind: "entry",
        subject: "nowhere/**",
        text: "policy entry nowhere/** matches no scanned file",
      },
    ]);
  });

  it("gives none without a policy and none for a policy that does not parse", () => {
    expect(problemsFor(null)).toEqual([]);
    expect(problemsFor("entry: [unbalanced")).toEqual([]);
  });
});
