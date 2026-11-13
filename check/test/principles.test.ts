import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PRINCIPLES, principleName, principleOf } from "../src/principles.js";
import { violationPrinciple } from "../src/structure-sensor.js";
import { REPO } from "./helpers.js";

const shared = JSON.parse(
  readFileSync(join(REPO, "fixtures/sensors/principles.json"), "utf8"),
);

describe("the principle registry", () => {
  it("pins each entry's id, name and citation", () => {
    expect(PRINCIPLES).toEqual([
      {
        id: "levelization",
        name: "Levelization",
        citation: {
          author: "John Lakos",
          work: "Large-Scale C++ Software Design",
          year: 1996,
        },
      },
      {
        id: "dependency-inversion-principle",
        name: "Dependency Inversion Principle",
        citation: {
          author: "Robert C. Martin",
          work: "The Dependency Inversion Principle, C++ Report",
          year: 1996,
        },
      },
      { id: "repository-policy", name: "Repository policy" },
      {
        id: "information-hiding",
        name: "Information hiding",
        citation: {
          author: "David Parnas",
          work: "On the Criteria To Be Used in Decomposing Systems into Modules",
          year: 1972,
        },
      },
      {
        id: "dead-code",
        name: "Dead code",
        citation: {
          author: "Robert C. Martin",
          work: "Clean Code",
          year: 2008,
          locator: "heuristic G9",
        },
      },
      {
        id: "small-functions",
        name: "Functions should be small",
        citation: {
          author: "Robert C. Martin",
          work: "Clean Code",
          year: 2008,
          locator: "chapter 3",
        },
      },
      {
        id: "dont-repeat-yourself",
        name: "Don't Repeat Yourself",
        citation: {
          author: "Andrew Hunt and David Thomas",
          work: "The Pragmatic Programmer",
          year: 1999,
        },
      },
      ...shared,
    ]);
  });

  it("has exactly eleven entries", () => {
    expect(PRINCIPLES).toHaveLength(11);
  });

  it("ends with the four entries fixtures/sensors/principles.json holds", () => {
    expect(PRINCIPLES.slice(7)).toEqual(shared);
    expect(shared).toHaveLength(4);
  });

  it("names a registered id and returns any other string unchanged", () => {
    expect(principleName("dead-code")).toBe("Dead code");
    expect(principleName("old-principle")).toBe("old-principle");
    expect(principleName("name-your-constants")).toBe("name-your-constants");
  });

  it("writes no citation key for the repository policy", () => {
    expect("citation" in principleOf("repository-policy")).toBe(false);
    expect(principleOf("levelization").citation?.year).toBe(1996);
  });
});

describe("the principle a rule violation cites", () => {
  const level = { type: "level", from_level: "a", to_level: "b" } as const;
  const uses = {
    type: "uses",
    from_component: "a",
    to_component: "b",
  } as const;
  const forbid = { type: "forbid", pattern: "* -> *" } as const;

  it("is the Dependency Inversion Principle when any rule is a level", () => {
    expect(violationPrinciple([level])).toBe("dependency-inversion-principle");
    expect(violationPrinciple([uses, level])).toBe(
      "dependency-inversion-principle",
    );
  });

  it("is the repository policy when every rule is uses or forbid", () => {
    expect(violationPrinciple([uses])).toBe("repository-policy");
    expect(violationPrinciple([uses, forbid])).toBe("repository-policy");
  });
});

describe("docs/design.md Principles table", () => {
  const design = readFileSync(join(REPO, "docs/design.md"), "utf8");
  const start = design.indexOf("## Principles");
  const table = design.slice(
    start,
    design.indexOf("\n## ", start + 1) === -1
      ? undefined
      : design.indexOf("\n## ", start + 1),
  );

  it("names every registered principle", () => {
    for (const entry of PRINCIPLES) {
      expect(table).toContain(entry.name);
    }
  });

  it.each([
    "`cycle`",
    "`levels`",
    "`uses` or `forbid`",
    "`unused_exports`",
    "`orphan`",
    "`private_imports`",
    "`long_function`",
    "`duplication`",
    "`crap`",
    "`mutation`",
    "`thresholds.complexity`",
    "`thresholds.coverage`",
  ])("has a row for %s", (kind) => {
    const rows = table
      .split("\n")
      .filter((line) => line.startsWith("|") && line.includes(kind));

    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
