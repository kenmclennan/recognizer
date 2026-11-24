import { describe, expect, it } from "vitest";
import { privateImportsWarnings } from "../src/application/analysis/private-imports-findings.js";
import {
  Dependency,
  File,
  LanguageBehaviour,
  type LanguageRule,
  Member,
  orphanWarnings,
  Repository,
} from "../src/index.js";
import { repositoryWith } from "./fakes/dependency-of.js";
import { BEHAVIOUR } from "./fakes/fixture-languages.js";
import { repositoryOf } from "./fakes/repository-of.js";

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
    const findings = privateImportsWarnings(
      repositoryExporting(false),
      null,
      BEHAVIOUR,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("private_imports");
    expect(findings[0]?.members?.map((member) => member.name)).toEqual([
      "_Base",
    ]);
  });

  it("an exported base class raises no finding", () => {
    expect(
      privateImportsWarnings(repositoryExporting(true), null, BEHAVIOUR),
    ).toEqual([]);
  });
});

function toyLanguage(
  name: string,
  flags: Pick<LanguageRule, "private_imports" | "supertype_links">,
): LanguageRule {
  return {
    name,
    extensions: [`.${name}`],
    files: [],
    skip: {
      directory_names: [],
      directory_prefixes: [],
      directory_suffixes: [],
      directory_markers: [],
      file_globs: [],
    },
    ...flags,
  };
}

describe("a scan holding a language that publishes a flag and one that does not", () => {
  const behaviour = new LanguageBehaviour([
    toyLanguage("yes", { private_imports: true, supertype_links: true }),
    toyLanguage("no", { private_imports: false, supertype_links: false }),
  ]);

  function mixed(): Repository {
    const dependency = (from: string, to: string, language: string) =>
      new Dependency({
        from,
        to,
        toLibrary: false,
        language,
        kind: "depends",
        line: 1,
        names: ["_hidden"],
      });
    const yes = repositoryOf({ "a.yes": "h", "b.yes": "h" }, [], "yes");
    const no = repositoryOf({ "a.no": "h", "b.no": "h" }, [], "no");

    return Repository.of({
      files: [...yes.files, ...no.files].map(
        (file) =>
          new File({
            ...file,
            members: file.path.startsWith("b.")
              ? [
                  new Member({
                    name: "_hidden",
                    exported: false,
                    kind: "function",
                    line: 1,
                  }),
                ]
              : [],
          }),
      ),
      extractions: [...yes.extractions, ...no.extractions],
      dependencies: [
        dependency("a.yes", "b.yes", "yes"),
        dependency("a.no", "b.no", "no"),
      ],
    });
  }

  it("private-imports findings name only the language that publishes the flag", () => {
    const findings = privateImportsWarnings(mixed(), null, behaviour);

    expect(findings.map((one) => one.id)).toEqual(["private_imports:a.yes"]);
  });

  it("orphan findings link supertypes only for the language that publishes the flag", () => {
    const base = mixed();
    const supertype = (from: string, to: string, language: string) =>
      new Dependency({
        from,
        to,
        toLibrary: false,
        language,
        kind: "implements",
        line: 1,
      });
    const repository = Repository.of({
      files: base.files,
      extractions: base.extractions,
      dependencies: [
        supertype("a.yes", "b.yes", "yes"),
        supertype("a.no", "b.no", "no"),
      ],
    });
    const found = orphanWarnings(
      repository,
      null,
      ["b.yes", "b.no"],
      [],
      behaviour,
    ).map((one) => one.id);

    expect(found).toEqual(["orphan:a.no"]);
  });
});
