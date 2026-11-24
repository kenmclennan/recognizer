import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const language = (name, root, output) => ({
  scanner: name,
  root,
  output,
  ...(name === "python" &&
  !output.includes("-layout/") &&
  !output.includes("script-folder/")
    ? { args: ["--source-root", "."] }
    : {}),
});

export const SCAN_TARGETS = [
  ...["python", "kotlin", "csharp", "rust", "typescript"].map((name) =>
    language(
      name,
      `fixtures/${name}/sample`,
      `fixtures/${name}/expected-scan.json`,
    ),
  ),
  language(
    "python",
    "fixtures/python/script-folder/sample",
    "fixtures/python/script-folder/expected-scan.json",
  ),
  language(
    "python",
    "fixtures/python/src-layout/sample",
    "fixtures/python/src-layout/expected-scan.json",
  ),
  ...["python", "kotlin", "rust", "typescript"].map((name) =>
    language(
      name,
      `fixtures/abstractness/${name}/sample`,
      `fixtures/abstractness/${name}/expected-scan.json`,
    ),
  ),
  ...["python", "kotlin", "csharp", "rust", "typescript"].map((name) =>
    language(
      name,
      `fixtures/supertype-edges/${name}/sample`,
      `fixtures/supertype-edges/${name}/expected-scan.json`,
    ),
  ),
  language(
    "csharp",
    "fixtures/csharp/markup-sample",
    "fixtures/csharp/markup-expected-scan.json",
  ),
  language(
    "kotlin",
    "fixtures/kotlin/di-orphans",
    "fixtures/kotlin/di-orphans/scan.json",
  ),
  language(
    "kotlin",
    "fixtures/kotlin/entry-points",
    "fixtures/kotlin/entry-points/scan.json",
  ),
  {
    ...language(
      "typescript",
      "fixtures/setup-loom",
      "fixtures/setup-loom/scan.json",
    ),
    modified: false,
  },
];

export const KEPT_BY_HAND = [
  "fixtures/check/scan.json",
  "fixtures/check-uses/scan.json",
  "fixtures/check-warnings/scan.json",
];

export const BASELINES = [
  {
    file: "fixtures/rust/recognizer-baseline.json",
    scanner: "rust",
    root: "repository",
    fields: ["files", "modules", "edges", "implements", "declares"],
  },
  {
    file: "fixtures/kotlin/petclinic-baseline.json",
    scanner: "kotlin",
    variable: "RECOGNIZER_KOTLIN_PETCLINIC",
    fields: ["edges", "damaged"],
  },
  {
    file: "fixtures/csharp/eshop-baseline.json",
    scanner: "csharp",
    variable: "RECOGNIZER_CSHARP_ESHOP",
    fields: ["edges", "calls", "damaged"],
  },
];

export const REVIEW_BY_HAND = [
  "packages/scanners/kotlin/tests/test_real_content.py: files 139, modules 134 and the 3, 82 and 35 counts",
  "packages/scanners/csharp/tests/test_real_content.py: files 605, modules 489, damaged 2 and orphans 50",
  "packages/app/test/unit/canvas-graph.test.ts: toHaveLength(13) and the title '15 boxes, 5 frames and 13 lines'",
  "each scanner's tests/test_fixture_and_cli.py: the counts pinned in test source",
];

const SCAN_NAMES = new Set([
  "expected-scan.json",
  "markup-expected-scan.json",
  "scan.json",
]);

export function committedScans(repository) {
  return execFileSync("git", ["ls-files", "fixtures"], {
    cwd: repository,
    encoding: "utf8",
  })
    .split("\n")
    .filter((path) => SCAN_NAMES.has(path.split("/").at(-1)));
}

export function resolveScans(
  repository,
  targets = SCAN_TARGETS,
  keptByHand = KEPT_BY_HAND,
) {
  const listed = new Set(targets.map((target) => target.output));
  const kept = new Set(keptByHand);
  const resolved = { targets: [], keptByHand: [], unlisted: [] };

  for (const path of committedScans(repository)) {
    const name = JSON.parse(readFileSync(join(repository, path), "utf8"))
      .scanner?.name;

    if (name === "hand-written") {
      (kept.has(path) ? resolved.keptByHand : resolved.unlisted).push(path);
    } else {
      (listed.has(path) ? resolved.targets : resolved.unlisted).push(path);
    }
  }

  return resolved;
}
