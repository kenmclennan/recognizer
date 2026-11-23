import { describe, expect, it } from "vitest";
import { joinRepositories } from "../../src/index.js";
import { repositoryOf } from "../fakes/repository-of.js";

describe("joinRepositories", () => {
  it("concatenates every list in order", () => {
    const first = repositoryOf({ "a.py": "1", "b.py": "2" }, []);
    const second = repositoryOf(
      { "C.kt": "3", "D.kt": "4", "E.kt": "5" },
      [],
      "kotlin",
    );
    const joined = joinRepositories([first, second]);

    expect(joined.files.map(({ path }) => path)).toEqual([
      "a.py",
      "b.py",
      "C.kt",
      "D.kt",
      "E.kt",
    ]);
  });

  it("keeps a dependency and a file present in only one part, and lists every extraction", () => {
    const first = {
      ...repositoryOf({ "a.py": "1", "b.py": "2" }, []),
      dependencies: [
        {
          from: "a.py",
          to: "b.py",
          toLibrary: false,
          language: "python",
          kind: "depends" as const,
          line: 1,
        },
      ],
    };
    const second = repositoryOf({ "C.kt": "3" }, [], "kotlin");
    const joined = joinRepositories([first, second]);

    expect(joined.dependencies).toEqual(first.dependencies);
    expect(joined.files.map(({ path }) => path)).toContain("C.kt");
    expect(joined.extractions.map(({ language }) => language)).toEqual([
      "python",
      "kotlin",
    ]);
  });
});
