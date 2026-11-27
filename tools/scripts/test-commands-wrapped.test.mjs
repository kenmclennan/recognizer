import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findViolations } from "./test-commands-wrapped.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const wrapped = "node ../../tools/scripts/assert-clean-tmpdir.mjs vitest run";

function realInput() {
  const rootPackage = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  );
  const scripts = [rootPackage, ...workspacePackages(rootPackage)].map(
    (pkg) => ({ name: pkg.name ?? "root", scripts: pkg.scripts ?? {} }),
  );
  const workflowDirectory = join(root, ".github", "workflows");
  const workflowLines = readdirSync(workflowDirectory)
    .filter((file) => file.endsWith(".yml"))
    .flatMap((file) =>
      readFileSync(join(workflowDirectory, file), "utf8")
        .split("\n")
        .filter((line) => /^\s*(-\s+)?run:/.test(line))
        .map((line) => ({ file, line })),
    );

  return { scripts, workflowLines };
}

function workspacePackages(rootPackage) {
  return rootPackage.workspaces.map((workspace) =>
    JSON.parse(readFileSync(join(root, workspace, "package.json"), "utf8")),
  );
}

describe("findViolations", () => {
  it("names an unwrapped script and a bare workflow runner", () => {
    const violations = findViolations({
      scripts: [
        { name: "a", scripts: { test: wrapped } },
        { name: "b", scripts: { "test:unit": "vitest run" } },
      ],
      workflowLines: [{ file: "x.yml", line: "      - run: uv run pytest" }],
    });

    expect(violations).toHaveLength(2);
    expect(violations[0]).toContain("b script test:unit");
    expect(violations[1]).toContain("x.yml");
  });

  it("returns none when every runner is wrapped", () => {
    expect(
      findViolations({
        scripts: [
          {
            name: "a",
            scripts: { test: `${wrapped} && ${wrapped}`, lint: "biome check" },
          },
        ],
        workflowLines: [
          {
            file: "x.yml",
            line: "      - run: node tools/scripts/assert-clean-tmpdir.mjs uv run pytest",
          },
          { file: "y.yml", line: "      - run: npm test -w packages/core" },
        ],
      }),
    ).toEqual([]);
  });

  it("real repository has no unwrapped test command", () => {
    expect(findViolations(realInput())).toEqual([]);
  });
});
