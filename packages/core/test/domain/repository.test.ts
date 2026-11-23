import { describe, expect, it } from "vitest";
import {
  Dependency,
  File,
  Finding,
  InvalidEntity,
  Member,
  Repository,
} from "../../src/index.js";
import { repositoryOf } from "../fakes/repository-of.js";

const file = (path: string, language: string, members: Member[] = []) =>
  new File({
    path,
    language,
    kind: "source",
    hash: null,
    members,
    entryPoint: false,
    annotations: [],
    actualOf: [],
  });

const dependency = (from: string, to: string, language: string) =>
  new Dependency({
    from,
    to,
    toLibrary: false,
    language,
    kind: "depends",
    line: 1,
  });

describe("Repository", () => {
  it("loads one path in two languages", () => {
    const repository = Repository.of({
      files: [file("src/util", "python"), file("src/util", "typescript")],
      dependencies: [dependency("src/util", "src/other", "typescript")],
    });

    expect(repository.filesAt("src/util")).toHaveLength(2);
    expect(repository.hasFile("src/util")).toBe(true);
  });

  it("looks a shared path up by language", () => {
    const repository = Repository.of({
      files: [file("src/util", "python"), file("src/util", "typescript")],
    });
    const at = repository.filesAt("src/util");

    expect(at).toHaveLength(2);
    expect(at.map((one) => one.language)).toEqual(["python", "typescript"]);
    expect(repository.file("src/util", "typescript")).toBe(at[1]);
    expect(repository.file("src/util")).toBe(at[0]);
    expect(repository.file("src/util", "kotlin")).toBeUndefined();
    expect(repository.file("src/missing")).toBeUndefined();
    expect(repository.filesAt("src/missing")).toEqual([]);
    expect(repository.hasFile("src/missing")).toBe(false);
  });

  it("refuses a path repeated within one language", () => {
    const build = () =>
      Repository.of({
        files: [
          file("src/util", "python"),
          file("src/util", "typescript"),
          file("src/util", "python"),
        ],
      });

    expect(build).toThrow(InvalidEntity);
    expect(build).toThrow(/src\/util \(python\)/);
  });

  it("collects every breach before refusing", () => {
    const build = () =>
      Repository.of({
        files: [file("a", "python"), file("a", "python"), file("b", "python")],
        dependencies: [dependency("a", "c", "typescript")],
      });

    expect(build).toThrow(/a path is repeated within one language/);
  });

  it("accepts a repository with one file and no dependency", () => {
    expect(Repository.of({ files: [file("a", "python")] }).files).toHaveLength(
      1,
    );
  });

  it("refuses a dependency that crosses languages", () => {
    const build = () =>
      Repository.of({
        files: [file("a", "python"), file("b", "typescript")],
        dependencies: [dependency("a", "b", "python")],
      });

    expect(build).toThrow(InvalidEntity);
    expect(build).toThrow(/a dependency crosses languages/);
  });

  it("refuses a dependency whose end is held only by another language", () => {
    const build = () =>
      Repository.of({
        files: [file("src/util", "python"), file("src/other", "typescript")],
        dependencies: [dependency("src/other", "src/util", "typescript")],
      });

    expect(build).toThrow(InvalidEntity);
  });

  it("accepts a dependency whose end is a library", () => {
    const repository = Repository.of({
      files: [file("a", "python")],
      dependencies: [dependency("a", "foreign:requests", "python")],
    });

    expect(repository.dependenciesOf("a")).toHaveLength(1);
    expect(repository.dependentsOf("foreign:requests")).toHaveLength(1);
  });

  it("derives its folders from its files", () => {
    const repository = Repository.of({
      files: [file("a/b/c.py", "python"), file("a/d.py", "python")],
    });

    expect(repository.folders.map(({ path }) => path)).toEqual(["a/b", "a"]);
    expect(repository.folder("a")?.holdsFile).toBe(true);
    expect(repository.folder("a/b")?.parent).toBe("a");
    expect(repository.filesIn("a").map(({ path }) => path)).toEqual(["a/d.py"]);
  });

  it("Repository.empty holds nothing", () => {
    expect(Repository.empty.files).toEqual([]);
    expect(Repository.empty.folders).toEqual([]);
  });

  it("join lists a shared folder once", () => {
    const first = Repository.of({ files: [file("src/a.py", "python")] });
    const second = Repository.of({ files: [file("src/B.kt", "kotlin")] });
    const joined = Repository.join([first, second]);

    expect(joined.folders.map(({ path }) => path)).toEqual(["src"]);
    expect(joined.files.map(({ path }) => path)).toEqual([
      "src/a.py",
      "src/B.kt",
    ]);
  });

  it("holdsTargetsOf is false when only some targets resolve", () => {
    const repository = Repository.of({
      files: [file("a.py", "python"), file("b.py", "python")],
    });

    expect(repository.holdsTargetsOf({ files: ["a.py", "b.py"] })).toBe(true);
    expect(repository.holdsTargetsOf({ files: ["x.py", "y.py"] })).toBe(false);
    expect(repository.holdsTargetsOf({ files: ["a.py", "y.py"] })).toBe(false);
    expect(repository.missingTargetsOf({ files: ["a.py", "y.py"] })).toEqual([
      "y.py",
    ]);
  });

  it("scannedHashes maps each extracted file to its hash", () => {
    const repository = repositoryOf({ "a.py": "ha", "b.py": "hb" }, []);

    expect([...repository.scannedHashes()]).toEqual([
      ["a.py", "ha"],
      ["b.py", "hb"],
    ]);
  });

  it("Finding.about uses the repository to check members", () => {
    const repository = Repository.of({
      files: [
        file("a.py", "python", [
          new Member({ name: "f", exported: true, kind: "function" }),
        ]),
      ],
    });
    const fields = {
      id: "x",
      kind: "k",
      severity: "warning" as const,
      principle: "p",
      summary: "s",
      files: ["a.py"],
      members: [{ file: "a.py", name: "g" }],
    };

    expect(() => Finding.about(repository, fields)).toThrow(/a\.py:g/);
    expect(
      Finding.about(repository, {
        ...fields,
        members: [{ file: "a.py", name: "f" }],
      }).touches("a.py"),
    ).toBe(true);
  });

  it("Repository.join concatenates every list in order", () => {
    const first = repositoryOf({ "a.py": "1", "b.py": "2" }, []);
    const second = repositoryOf(
      { "C.kt": "3", "D.kt": "4", "E.kt": "5" },
      [],
      "kotlin",
    );
    const joined = Repository.join([first, second]);

    expect(joined.files.map(({ path }) => path)).toEqual([
      "a.py",
      "b.py",
      "C.kt",
      "D.kt",
      "E.kt",
    ]);
  });

  it("Repository.join keeps a dependency and a file present in only one part, and lists every extraction", () => {
    const first = Repository.of({
      ...repositoryOf({ "a.py": "1", "b.py": "2" }, []),
      dependencies: [
        new Dependency({
          from: "a.py",
          to: "b.py",
          toLibrary: false,
          language: "python",
          kind: "depends",
          line: 1,
        }),
      ],
    });
    const second = repositoryOf({ "C.kt": "3" }, [], "kotlin");
    const joined = Repository.join([first, second]);

    expect(joined.dependencies).toEqual(first.dependencies);
    expect(joined.files.map(({ path }) => path)).toContain("C.kt");
    expect(joined.extractions.map(({ language }) => language)).toEqual([
      "python",
      "kotlin",
    ]);
  });
});
