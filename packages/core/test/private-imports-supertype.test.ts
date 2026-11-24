import { describe, expect, it } from "vitest";
import { privateImportsWarnings } from "../src/application/analysis/private-imports-findings.js";
import { Dependency, File, Member, Repository } from "../src/index.js";
import { repositoryWith } from "./fakes/dependency-of.js";

function repositoryExporting(exported: boolean): Repository {
  const base = repositoryWith(
    ["sub.py", "base.py"],
    [
      new Dependency({
        from: "sub.py",
        to: "base.py",
        toLibrary: false,
        language: "python",
        kind: "inherits",
        line: 3,
        member: "Child",
        toMember: "_Base",
      }),
    ],
  );

  return Repository.of({
    ...base,
    files: base.files.map((file) =>
      file.path === "base.py"
        ? new File({
            ...file,
            members: [
              new Member({
                name: "_Base",
                exported,
                kind: "class",
                line: 1,
              }),
            ],
          })
        : file,
    ),
  });
}

describe("private imports through a supertype edge", () => {
  it("a private base class imported only as a base still raises the finding", () => {
    const findings = privateImportsWarnings(repositoryExporting(false), null);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("private_imports");
    expect(findings[0]?.members?.map((member) => member.name)).toEqual([
      "_Base",
    ]);
  });

  it("an exported base class raises no finding", () => {
    expect(privateImportsWarnings(repositoryExporting(true), null)).toEqual([]);
  });
});
