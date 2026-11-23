import { describe, expect, it } from "vitest";
import {
  File,
  Finding,
  type FindingFields,
  InvalidEntity,
  Member,
  Repository,
} from "../../src/index.js";

const repository = Repository.of({
  files: [
    new File({
      path: "a.py",
      language: "python",
      kind: "source",
      hash: null,
      members: [new Member({ name: "f", exported: true })],
      entryPoint: false,
      annotations: [],
      actualOf: [],
    }),
  ],
});

const fields = (over: Partial<FindingFields> = {}): FindingFields => ({
  id: "x",
  kind: "k",
  severity: "warning",
  principle: "p",
  summary: "s",
  files: ["a.py"],
  ...over,
});

describe("Finding", () => {
  it("about accepts a file and a member the repository holds", () => {
    const finding = Finding.about(
      repository,
      fields({ members: [{ file: "a.py", name: "f" }] }),
    );

    expect(finding.touches("a.py")).toBe(true);
    expect(finding.touches("b.py")).toBe(false);
  });

  it("about refuses a file the repository lacks", () => {
    expect(() =>
      Finding.about(repository, fields({ files: ["a.py", "gone.py"] })),
    ).toThrow(InvalidEntity);
    expect(() =>
      Finding.about(repository, fields({ files: ["a.py", "gone.py"] })),
    ).toThrow(/gone\.py/);
  });

  it("about names exactly the missing paths and not the present ones", () => {
    const refused = () =>
      Finding.about(
        repository,
        fields({ files: ["a.py", "gone.py", "no.py"] }),
      );

    expect(refused).toThrow(/"gone\.py, no\.py"/);
  });

  it("about refuses a member the file lacks", () => {
    expect(() =>
      Finding.about(
        repository,
        fields({ members: [{ file: "a.py", name: "nope" }] }),
      ),
    ).toThrow(/a\.py:nope/);
  });

  it("a stored finding about an absent file loads", () => {
    const finding = Finding.stored(fields({ files: ["gone.py"] }));

    expect(finding.files).toEqual(["gone.py"]);
    expect(repository.holdsTargetsOf(finding)).toBe(false);
  });

  it("with derives a finding that keeps what was not changed", () => {
    const finding = Finding.stored(fields({ producer: "p1" }));
    const next = finding.with({ summary: "t" });

    expect(next.summary).toBe("t");
    expect(next.producer).toBe("p1");
    expect(finding.summary).toBe("s");
  });
});
