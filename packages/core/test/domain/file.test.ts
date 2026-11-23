import { describe, expect, it } from "vitest";
import {
  File,
  type FileFields,
  InvalidEntity,
  Member,
} from "../../src/index.js";

const fields = (over: Partial<FileFields> = {}): FileFields => ({
  path: "src/a.py",
  language: "python",
  kind: "source",
  hash: null,
  members: [],
  entryPoint: false,
  annotations: [],
  actualOf: [],
  ...over,
});

describe("File", () => {
  it("derives its folder from its path", () => {
    expect(new File(fields()).folder).toBe("src");
    expect(new File(fields({ path: "a.py" })).folder).toBeNull();
  });

  it("finds a member by name", () => {
    const member = new Member({ name: "f", exported: true });
    const file = new File(fields({ members: [member] }));

    expect(file.member("f")).toBe(member);
    expect(file.hasMember("f")).toBe(true);
    expect(file.hasMember("g")).toBe(false);
  });

  it("refuses an empty path", () => {
    expect(() => new File(fields({ path: "" }))).toThrow(InvalidEntity);
  });

  it("refuses an empty language", () => {
    expect(() => new File(fields({ language: "" }))).toThrow(
      /language is empty/,
    );
  });

  it("refuses a kind outside source, package and interface", () => {
    expect(
      () => new File(fields({ kind: "folder" as unknown as "source" })),
    ).toThrow(/"folder"/);
  });

  it("accepts a path of one segment", () => {
    expect(new File(fields({ path: "a" })).path).toBe("a");
  });

  describe("File.nameOf", () => {
    it("keeps the file extension and drops the folders", () => {
      expect(File.nameOf("a/b/x.py")).toBe("x.py");
      expect(File.nameOf("top.ts")).toBe("top.ts");
    });
  });
});
