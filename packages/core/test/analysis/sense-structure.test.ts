import { describe, expect, it } from "vitest";
import {
  DEFAULT_STRUCTURE_SETTINGS,
  Dependency,
  File,
  Member,
  Repository,
  senseStructure,
  Warning,
} from "../../src/index.js";
import { repositoryOf } from "../fakes/repository-of.js";
import { breaching, FORBID } from "./analysis-world.js";

function spied(repository: Repository) {
  const calls = { violations: 0, cycleWarnings: 0 };
  const violations = repository.violations.bind(repository);
  const cycleWarnings = repository.cycleWarnings.bind(repository);

  repository.violations = (rules) => {
    calls.violations += 1;

    return violations(rules);
  };
  repository.cycleWarnings = (rules) => {
    calls.cycleWarnings += 1;

    return cycleWarnings(rules);
  };

  return calls;
}

const CONTEXT = { commit: "", modified: false };

describe("senseStructure", () => {
  it("calls the entity methods", () => {
    const repository = breaching();
    const calls = spied(repository);

    senseStructure(repository, [FORBID], DEFAULT_STRUCTURE_SETTINGS, CONTEXT);

    expect(calls).toEqual({ violations: 1, cycleWarnings: 1 });
  });

  it("asks for no cycle warnings when the setting is off", () => {
    const repository = breaching();
    const calls = spied(repository);

    senseStructure(
      repository,
      [FORBID],
      {
        ...DEFAULT_STRUCTURE_SETTINGS,
        warnings: { ...DEFAULT_STRUCTURE_SETTINGS.warnings, cycle: false },
      },
      CONTEXT,
    );

    expect(calls).toEqual({ violations: 1, cycleWarnings: 0 });
  });

  it("writes each warning kind as the finding it wrote before", () => {
    const base = repositoryOf(
      {
        "cyc_a.py": "h",
        "cyc_b.py": "h",
        "lib.py": "h",
        "user.py": "h",
        "orphan.py": "h",
      },
      [],
    );
    const edge = (from: string, to: string, names?: string[]) =>
      new Dependency({
        from,
        to,
        toLibrary: false,
        language: "python",
        kind: "depends",
        line: 2,
        ...(names === undefined ? {} : { names }),
      });
    const repository = Repository.of({
      ...base,
      files: base.files.map((file) =>
        file.path === "lib.py"
          ? new File({
              ...file,
              members: [
                new Member({
                  name: "_hidden",
                  exported: false,
                  kind: "function",
                  line: 1,
                  endLine: 3,
                }),
                new Member({
                  name: "long",
                  exported: true,
                  kind: "function",
                  line: 5,
                  endLine: 205,
                  bodyLine: 6,
                }),
              ],
            })
          : file,
      ),
      dependencies: [
        edge("cyc_a.py", "cyc_b.py"),
        edge("cyc_b.py", "cyc_a.py"),
        edge("user.py", "lib.py", ["_hidden"]),
      ],
    });

    const { document } = senseStructure(
      repository,
      null,
      {
        ...DEFAULT_STRUCTURE_SETTINGS,
        warnings: {
          ...DEFAULT_STRUCTURE_SETTINGS.warnings,
          unused_exports: true,
        },
      },
      CONTEXT,
    );

    expect(document.findings.map((one) => one.id)).toEqual([
      "cycle:cyc_a.py,cyc_b.py",
      "orphan:orphan.py",
      "orphan:user.py",
      "unused_exports:lib.py",
      "private_imports:user.py",
      "long_function:lib.py::long",
    ]);
    expect(document.findings.every((one) => one.severity === "warning")).toBe(
      true,
    );
  });

  it("drops a second warning with the same id", () => {
    const repository = repositoryOf({ "a.py": "h" }, []);
    const warning = (summary: string) =>
      new Warning({
        kind: "cycle",
        id: "cycle:a.py",
        principle: "levelization",
        summary,
        files: ["a.py"],
      });

    repository.cycleWarnings = () => [warning("first"), warning("second")];

    const { document } = senseStructure(
      repository,
      null,
      DEFAULT_STRUCTURE_SETTINGS,
      CONTEXT,
    );
    const kept = document.findings.filter((one) => one.id === "cycle:a.py");

    expect(kept.map((one) => one.summary)).toEqual(["first"]);
  });
});
