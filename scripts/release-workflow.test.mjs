import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const SOURCE = readFileSync(
  fileURLToPath(new URL("../.github/workflows/release.yml", import.meta.url)),
  "utf8",
);
const WORKFLOW = parse(SOURCE);
const STEPS = WORKFLOW.jobs.release.steps;

function index(name) {
  const found = STEPS.findIndex((step) => step.name === name);

  expect(found, `step "${name}" exists`).toBeGreaterThanOrEqual(0);

  return found;
}

describe("release.yml", () => {
  it("starts only on workflow_dispatch with an optional commit input", () => {
    expect(Object.keys(WORKFLOW.on)).toEqual(["workflow_dispatch"]);
    expect(WORKFLOW.on.workflow_dispatch.inputs.commit).toBeDefined();
    expect(WORKFLOW.on.workflow_dispatch.inputs.commit.required).not.toBe(true);
  });

  it("opens the app after the toolchain smoke test and before publishing", () => {
    const open = index("Open the app ten times");

    expect(open).toBeGreaterThan(index("Smoke-test the bundled toolchain"));
    expect(open).toBeLessThan(index("Publish the release"));
  });

  it("requires the commit on main between the open check and publishing", () => {
    const onMain = index("Require the commit on main");

    expect(onMain).toBeGreaterThan(index("Open the app ten times"));
    expect(onMain).toBeLessThan(index("Publish the release"));
  });

  it("requires the app workflow to have passed before the toolchain build", () => {
    expect(index("Require the app workflow to have passed")).toBeLessThan(
      index("Build the CLI toolchain folder"),
    );
  });

  it("guards every step after the skip step, apart from the cleanup", () => {
    const after = STEPS.slice(index("Skip an already released commit") + 1);

    for (const step of after) {
      if (step.if === "always()") {
        continue;
      }

      expect(step.if, step.name).toContain(
        "steps.released.outputs.skip != 'true'",
      );
    }
  });

  it("mentions workflow_run in no job condition or env value", () => {
    for (const job of Object.values(WORKFLOW.jobs)) {
      expect(String(job.if ?? "")).not.toContain("workflow_run");
      expect(JSON.stringify(job.env ?? {})).not.toContain("workflow_run");
    }
  });
});
