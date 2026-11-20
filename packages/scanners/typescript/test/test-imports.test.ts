import { describe, expect, it } from "vitest";
import { scanTree } from "./helpers.js";

const body = "export const a = 1;\nexport const b = 2;\n";

describe("test imports", () => {
  it("writes an empty list when no test file exists", () => {
    expect(scanTree({ "a.ts": body }).test_imports).toEqual([]);
  });

  it("records the modules a test file imports with the names it takes", () => {
    const doc = scanTree({
      "src/m.ts": body,
      "src/m.test.ts": 'import { b, a } from "./m";\n',
      "src/n.ts": body,
      "src/n.spec.ts": 'import * as n from "./n";\nimport { a } from "./n";\n',
      "tests/helpers.ts": 'import { a } from "../src/m";\n',
    });

    expect(doc.test_imports).toEqual([
      { from: "src/m.test.ts", to: "src/m.ts", names: ["a", "b"] },
      { from: "src/n.spec.ts", to: "src/n.ts" },
      { from: "tests/helpers.ts", to: "src/m.ts", names: ["a"] },
    ]);
    expect(doc.modules.map((m) => m.id)).toEqual(["src/m.ts", "src/n.ts"]);
    expect(doc.files.map((f) => f.path)).toEqual(["src/m.ts", "src/n.ts"]);
    expect(doc.edges).toEqual([]);
  });

  it("reads nested test directories and sorts and de-duplicates records", () => {
    const doc = scanTree({
      "m.ts": body,
      "z/__tests__/deep/z.ts":
        'import { a } from "../../../m";\nimport { b } from "../../../m";\n',
      "a/test/a.ts": 'import { a } from "../../m";\n',
    });

    expect(doc.test_imports).toEqual([
      { from: "a/test/a.ts", to: "m.ts", names: ["a"] },
      { from: "z/__tests__/deep/z.ts", to: "m.ts", names: ["a", "b"] },
    ]);
  });

  it("gives no record for a skipped non-test directory, a declaration file or a foreign package", () => {
    const doc = scanTree({
      "m.ts": body,
      "build/b.ts": body,
      "build/tests/x.test.ts": 'import { a } from "../../m";\n',
      ".hidden/y.test.ts": 'import { a } from "../m";\n',
      "z.test.ts":
        'import { b } from "./build/b";\nimport x from "left-pad";\n',
      "m.test.d.ts": 'import { a } from "./m";\n',
    });

    expect(doc.test_imports).toEqual([]);
  });

  it("contributes nothing for a test file with a syntax error and still scans", () => {
    const doc = scanTree({
      "m.ts": body,
      "bad.test.ts": 'import { a } from "./m";\nconst = ;\n',
      "ok.test.ts": 'import { a } from "./m";\n',
    });

    expect(doc.test_imports).toEqual([
      { from: "ok.test.ts", to: "m.ts", names: ["a"] },
    ]);
  });
});
