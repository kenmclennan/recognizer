import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const TEST_FILE =
  /(^|\/)(test|tests)\/.*\.(ts|mjs|js)$|\.test\.(ts|mjs)$|^packages\/app\/src\/look-page\.ts$/;

const DIRECT_CALL = /\bmkdtemp(Sync)?\b/;

export const PERMANENT_EXCLUSIONS = [
  {
    path: "tools/scripts/assert-clean-tmpdir.test.mjs",
    reason:
      "child scripts that leak or tidy a folder on purpose, to prove the wrapper catches it",
  },
  {
    path: "tools/scripts/direct-temp-dirs.test.mjs",
    reason: "names the call it forbids in fixture source",
  },
];

export function directTempDirFiles(root, files = listedFiles(root)) {
  const excluded = new Set(PERMANENT_EXCLUSIONS.map((entry) => entry.path));

  return files
    .filter((file) => TEST_FILE.test(file) && !excluded.has(file))
    .filter((file) => DIRECT_CALL.test(readFileSync(`${root}/${file}`, "utf8")))
    .sort();
}

function listedFiles(root) {
  return execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}
