import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  directTempDirFiles,
  PERMANENT_EXCLUSIONS,
} from "./direct-temp-dirs.mjs";
import { makeTempDir } from "./temp-dirs.mjs";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const CALL = ["mkdtemp", "Sync"].join("");

function tree(files) {
  const root = makeTempDir("direct-temp-dirs-");

  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }

  return root;
}

describe("test code makes its temp folders with makeTempDir", () => {
  it("no test file calls mkdtemp directly", () => {
    expect(directTempDirFiles(REPO)).toEqual([]);
  });

  it("names a test file that calls mkdtemp directly", () => {
    const files = {
      "packages/x/test/bad.test.ts": `${CALL}(a);`,
      "packages/x/test/good.test.ts": `makeTempDir("a-");`,
      "packages/x/src/product.ts": `${CALL}(a);`,
    };
    const root = tree(files);

    expect(directTempDirFiles(root, Object.keys(files))).toEqual([
      "packages/x/test/bad.test.ts",
    ]);
  });

  it("gives every permanent exclusion a reason", () => {
    for (const entry of PERMANENT_EXCLUSIONS) {
      expect(entry.reason.length).toBeGreaterThan(0);
    }
  });
});
