import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type AnsweredRunner,
  type AnsweredTool,
  assembleRunners,
  folderSlug,
  type PluginAnswer,
  type SurveyAnswer,
} from "../../src/index.js";

const REPO = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

function runner(
  directory: string,
  from: string,
  extra: Partial<AnsweredRunner> = {},
): AnsweredRunner {
  return {
    language: "typescript",
    runner: "vitest",
    directory,
    from,
    command:
      "npx vitest run --coverage.reportsDirectory={up}.recognizer/cache/coverage/{slug}",
    coverage: {
      path: "{up}.recognizer/cache/coverage/{slug}/lcov.info",
      format: "lcov",
    },
    tool: null,
    ...extra,
  };
}

function tool(
  name: string,
  neededBy: string[],
  extra: Partial<AnsweredTool> = {},
): AnsweredTool {
  return {
    name,
    kind: "npm",
    installed: false,
    why: "w",
    needed_by: neededBy,
    installs: `npm install ${name}`,
    command: ["npm", "install", name],
    cwd: ".",
    ...extra,
  };
}

function answered(
  plugin: string,
  order: number,
  answer: Partial<SurveyAnswer>,
): PluginAnswer {
  return {
    plugin,
    order,
    language: plugin,
    answer: { runners: [], tools: [], notes: [], ...answer },
  };
}

describe("recognizer setup survey", () => {
  it("slugs a suite name as the sensors do", () => {
    const rows = JSON.parse(
      readFileSync(join(REPO, "fixtures/suites/folder-slugs.json"), "utf8"),
    ) as { name: string; slug: string }[];

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => /[^A-Za-z0-9._-]/.test(row.name))).toBe(true);
    expect(rows.some((row) => row.name.startsWith("."))).toBe(true);

    for (const row of rows) {
      expect(folderSlug(row.name)).toBe(row.slug);
    }
  });
});

describe("assembling the survey answers", () => {
  const ROOT = "/work/loom";

  it("orders answers by order and then by plugin name", () => {
    const assembled = assembleRunners(
      [
        answered("b", 2, { runners: [runner("two", "two/package.json")] }),
        answered("z", 1, { runners: [runner("zed", "zed/package.json")] }),
        answered("a", 2, { runners: [runner("one", "one/package.json")] }),
      ],
      ROOT,
    );

    expect(assembled.runners.map((one) => one.name)).toEqual([
      "zed",
      "one",
      "two",
    ]);
  });

  it("names a collision across plugins and the suite names already taken", () => {
    const assembled = assembleRunners(
      [
        answered("a", 1, { runners: [runner("loom", "loom/package.json")] }),
        answered("b", 2, {
          runners: [
            runner("loom", "loom/Cargo.toml", { language: "rust" }),
            runner("src-app", "src-app/Cargo.toml", { language: "rust" }),
            runner("taken", "taken/Cargo.toml", { language: "rust" }),
          ],
        }),
      ],
      ROOT,
      new Set(["taken"]),
    );

    expect(assembled.runners.map((one) => one.name)).toEqual([
      "loom",
      "loom-2",
      "app",
      "taken-2",
    ]);
  });

  it("substitutes up and slug for a runner at the root and at depth 2", () => {
    const assembled = assembleRunners(
      [
        answered("a", 1, {
          runners: [
            runner(".", "package.json"),
            runner("tools/web", "tools/web/package.json"),
          ],
        }),
      ],
      "/work/repository",
    );
    const [root, deep] = assembled.runners;

    expect(root?.name).toBe("repository");
    expect(root?.command).toContain(
      "--coverage.reportsDirectory=.recognizer/cache/coverage/repository",
    );
    expect(root?.coverage.path).toBe(
      ".recognizer/cache/coverage/repository/lcov.info",
    );
    expect(deep?.name).toBe("web");
    expect(deep?.command).toContain(
      "--coverage.reportsDirectory=../../.recognizer/cache/coverage/web",
    );
    expect(deep?.coverage.path).toBe(
      "../../.recognizer/cache/coverage/web/lcov.info",
    );
  });

  it("collapses a doubled brace and keeps the single one", () => {
    const assembled = assembleRunners(
      [
        answered("a", 1, {
          runners: [
            runner("app", "app/package.json", {
              command: "echo {{literal}} {slug}",
            }),
          ],
        }),
      ],
      ROOT,
    );

    expect(assembled.runners[0]?.command).toBe("echo {literal} app");
  });

  it("maps needed_by from the from values to the runner names", () => {
    const assembled = assembleRunners(
      [
        answered("a", 1, {
          runners: [
            runner("engine", "engine/package.json"),
            runner("app", "app/package.json"),
          ],
          tools: [tool("cov", ["engine/package.json", "app/package.json"])],
        }),
      ],
      ROOT,
    );

    expect(assembled.tools[0]?.needed_by).toEqual(["engine", "app"]);
  });

  it("resolves a placeholder in a tool against its one runner", () => {
    const assembled = assembleRunners(
      [
        answered("a", 1, {
          runners: [runner("tools/web", "tools/web/package.json")],
          tools: [
            tool("cov", ["tools/web/package.json"], {
              installs: "cd {up} && install {slug}",
              command: ["install", "{slug}", "{up}"],
              prepare: [["mkdir", "{up}x"]],
            }),
          ],
        }),
      ],
      ROOT,
    );

    expect(assembled.tools[0]).toMatchObject({
      installs: "cd ../../ && install web",
      command: ["install", "web", "../../"],
      prepare: [["mkdir", "../../x"]],
    });
  });

  it("rejects an unknown brace, a duplicate from and a placeholder in a tool needed by two runners", () => {
    const unknown = assembleRunners(
      [
        answered("a", 1, {
          runners: [runner("app", "app/package.json", { command: "x {nope}" })],
        }),
      ],
      ROOT,
    );
    const duplicate = assembleRunners(
      [
        answered("a", 1, {
          runners: [
            runner("app", "app/package.json"),
            runner("app2", "app/package.json"),
          ],
        }),
      ],
      ROOT,
    );
    const shared = assembleRunners(
      [
        answered("a", 1, {
          runners: [
            runner("engine", "engine/package.json"),
            runner("app", "app/package.json"),
          ],
          tools: [
            tool("cov", ["engine/package.json", "app/package.json"], {
              command: ["install", "{slug}"],
            }),
          ],
        }),
      ],
      ROOT,
    );

    for (const one of [unknown, duplicate, shared]) {
      expect(one.runners).toEqual([]);
      expect(one.tools).toEqual([]);
      expect(one.notes).toHaveLength(1);
    }

    expect(unknown.notes[0]?.text).toMatch(
      /^a did not answer the setup survey: .*brace/,
    );
    expect(duplicate.notes[0]?.text).toMatch(
      /two runners come from app\/package.json/,
    );
    expect(shared.notes[0]?.text).toMatch(/more than one runner/);
  });

  it("passes runner settings through unchanged and refuses reserved or braced ones", () => {
    const settings = { runner: "vitest" };
    const kept = assembleRunners(
      [
        answered("a", 1, {
          runners: [runner("app", "app/package.json", { settings })],
        }),
      ],
      ROOT,
    );
    const reserved = assembleRunners(
      [
        answered("b", 2, {
          runners: [
            runner("x", "x/package.json", { settings: { language: "rust" } }),
          ],
        }),
      ],
      ROOT,
    );
    const braced = assembleRunners(
      [
        answered("c", 3, {
          runners: [
            runner("y", "y/package.json", { settings: { runner: "{slug}" } }),
          ],
        }),
      ],
      ROOT,
    );
    const mixed = assembleRunners(
      [
        answered("a", 1, {
          runners: [runner("app", "app/package.json", { settings })],
        }),
        answered("b", 2, {
          runners: [
            runner("x", "x/package.json", { settings: { env: "FOO" } }),
          ],
        }),
      ],
      ROOT,
    );

    expect(kept.runners[0]?.settings).toEqual(settings);
    expect(reserved.runners).toEqual([]);
    expect(reserved.notes[0]?.text).toBe(
      "b did not answer the setup survey: a runner of x/package.json sets language, which core writes itself",
    );
    expect(braced.runners).toEqual([]);
    expect(braced.notes[0]?.text).toMatch(/brace that is not a placeholder/);
    expect(mixed.runners.map((one) => one.name)).toEqual(["app"]);
    expect(mixed.notes).toHaveLength(1);
    expect(mixed.notes[0]?.text).toMatch(/sets env, which core writes itself/);
  });

  it("carries a tool of any kind through to the survey unchanged", () => {
    const assembled = assembleRunners(
      [
        answered("a", 1, {
          runners: [runner("app", "app/package.json")],
          tools: [tool("cov", ["app/package.json"], { kind: "yarn" })],
        }),
      ],
      ROOT,
    );

    expect(assembled.tools[0]?.kind).toBe("yarn");
  });

  it("keeps the first plugin's runners when one fails and one answers an invalid document", () => {
    const assembled = assembleRunners(
      [
        answered("first", 1, {
          runners: [runner("engine", "engine/package.json")],
          notes: [{ language: "typescript", directory: "engine", text: "n" }],
        }),
        {
          plugin: "second",
          order: 2,
          language: "rust",
          failure: "second exited 3",
        },
        answered("third", 3, {
          runners: [runner("bad", "bad/package.json", { command: "{x}" })],
        }),
      ],
      ROOT,
    );

    expect(assembled.runners.map((one) => one.name)).toEqual(["engine"]);
    expect(assembled.notes.map((note) => note.text)).toEqual([
      "n",
      "second did not answer the setup survey: second exited 3",
      expect.stringMatching(/^third did not answer the setup survey: /),
    ]);
    expect(
      assembled.notes.filter((note) => note.directory === "."),
    ).toHaveLength(2);
    expect(assembled.notes[1]).toMatchObject({
      language: "rust",
      directory: ".",
    });
  });

  describe("coverage format", () => {
    const FORMATS = ["lcov", "jacoco"];

    function withFormat(plugin: string, order: number, format: string) {
      return answered(plugin, order, {
        runners: [
          runner(plugin, `${plugin}/package.json`, {
            coverage: { path: "c", format },
          }),
        ],
      });
    }

    it("accepts the last published format and the first", () => {
      const assembled = assembleRunners(
        [withFormat("a", 1, "jacoco"), withFormat("b", 2, "lcov")],
        ROOT,
        new Set(),
        FORMATS,
      );

      expect(assembled.runners.map((one) => one.coverage.format)).toEqual([
        "jacoco",
        "lcov",
      ]);
      expect(assembled.notes).toEqual([]);
    });

    it("refuses a format no sensor publishes with one note", () => {
      const assembled = assembleRunners(
        [withFormat("vitest-scanner", 1, "cobertura")],
        ROOT,
        new Set(),
        FORMATS,
      );

      expect(assembled.runners).toEqual([]);
      expect(assembled.notes).toEqual([
        {
          language: "vitest-scanner",
          directory: ".",
          text: "vitest-scanner did not answer the setup survey: a runner of vitest-scanner/package.json answers coverage format cobertura, which no installed sensor reads (they read: lcov, jacoco)",
        },
      ]);
    });

    it("judges against a published list of one", () => {
      const assembled = assembleRunners(
        [withFormat("a", 1, "lcov"), withFormat("b", 2, "jacoco")],
        ROOT,
        new Set(),
        ["lcov"],
      );

      expect(assembled.runners.map((one) => one.name)).toEqual(["a"]);
      expect(assembled.notes).toHaveLength(1);
    });

    it("checks nothing when nothing is published", () => {
      const assembled = assembleRunners(
        [withFormat("a", 1, "cobertura")],
        ROOT,
        new Set(),
        null,
      );

      expect(assembled.runners).toHaveLength(1);
      expect(assembled.notes).toEqual([]);
    });

    it("lists the good runner and refuses the other plugin in one note", () => {
      const assembled = assembleRunners(
        [withFormat("good", 1, "lcov"), withFormat("bad", 2, "cobertura")],
        ROOT,
        new Set(),
        FORMATS,
      );

      expect(assembled.runners.map((one) => one.name)).toEqual(["good"]);
      expect(assembled.notes).toHaveLength(1);
      expect(assembled.notes[0]?.text).toContain("bad did not answer");
    });
  });
});
