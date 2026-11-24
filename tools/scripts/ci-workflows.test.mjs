import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DIRECTORY = `${ROOT}.github/workflows/`;

const WORKFLOWS = readdirSync(DIRECTORY)
  .filter((name) => name.endsWith(".yml"))
  .map((name) => {
    const text = readFileSync(DIRECTORY + name, "utf8");

    return { name, text, workflow: parse(text) };
  });

const MAIN = ["$", "{{ github.ref == 'refs/heads/main' }}"].join("");

const CANCEL_IN_PROGRESS = {
  "app.yml": true,
  "check.yml": MAIN,
  "describer-claude.yml": MAIN,
  "markdown.yml": MAIN,
  "release.yml": false,
  "scanner-csharp.yml": MAIN,
  "scanner-kotlin.yml": MAIN,
  "scanner-python.yml": MAIN,
  "scanner-rust.yml": MAIN,
  "scanner-typescript.yml": MAIN,
  "schema-compat.yml": MAIN,
  "sensors.yml": MAIN,
};

describe("ci workflows", () => {
  it("are found", () => {
    expect(WORKFLOWS.length).toBeGreaterThan(0);
  });

  it("have no cancel-on-failure step and no such action", () => {
    expect(existsSync(`${ROOT}.github/actions/cancel-on-failure`)).toBe(false);

    for (const { name, text } of WORKFLOWS) {
      expect(text, name).not.toContain("cancel-on-failure");
    }
  });

  it("set fail-fast false on every matrix outside release.yml", () => {
    const matrixed = WORKFLOWS.filter(
      ({ name, text }) => name !== "release.yml" && text.includes("matrix:"),
    );

    expect(matrixed.length).toBeGreaterThan(0);

    for (const { name, text } of matrixed) {
      expect(text, name).toContain("fail-fast: false");
    }
  });

  it("keep every cancel-in-progress value", () => {
    const actual = Object.fromEntries(
      WORKFLOWS.filter(({ workflow }) => workflow.concurrency).map(
        ({ name, workflow }) => [
          name,
          workflow.concurrency["cancel-in-progress"],
        ],
      ),
    );

    for (const [name, value] of Object.entries(CANCEL_IN_PROGRESS)) {
      expect(actual[name], name).toEqual(value);
    }
  });

  it("add regenerate.yml, which runs on pull requests and on push to main", () => {
    const regenerate = WORKFLOWS.find(({ name }) => name === "regenerate.yml");

    expect(regenerate, "regenerate.yml exists").toBeDefined();
    expect(regenerate.workflow.on.pull_request.paths.length).toBeGreaterThan(0);
    expect(regenerate.workflow.on.push.branches).toEqual(["main"]);
    expect(regenerate.text).toContain("npm run regenerate");
    expect(regenerate.text).toContain("regenerate-check.mjs");
  });
});
