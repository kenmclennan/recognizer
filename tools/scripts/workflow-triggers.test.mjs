import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const DIRECTORY = fileURLToPath(
  new URL("../../.github/workflows/", import.meta.url),
);

const NOT_TESTING = new Set([
  "build-plugin.yml",
  "release.yml",
  "schema-behind.yml",
  "tap-smoke.yml",
]);

const WORKFLOWS = readdirSync(DIRECTORY)
  .filter((name) => name.endsWith(".yml") && !NOT_TESTING.has(name))
  .map((name) => ({
    name,
    workflow: parse(readFileSync(DIRECTORY + name, "utf8")),
  }));

describe("testing workflows", () => {
  it("are found", () => {
    expect(WORKFLOWS.length).toBeGreaterThan(0);
  });

  for (const { name, workflow } of WORKFLOWS) {
    describe(name, () => {
      it("runs on every push to main with no path filter", () => {
        const push = workflow.on.push;

        expect(push, "has a push trigger").toBeDefined();
        expect(push.branches).toEqual(["main"]);
        expect(push.paths).toBeUndefined();
        expect(push["paths-ignore"]).toBeUndefined();
      });

      it("has a concurrency group per workflow and ref that cancels on main", () => {
        const { concurrency } = workflow;

        expect(concurrency, "has a concurrency block").toBeDefined();
        expect(concurrency.group).toContain("github.ref");
        expect(String(concurrency["cancel-in-progress"])).toMatch(
          /true|refs\/heads\/main/,
        );
      });
    });
  }
});
