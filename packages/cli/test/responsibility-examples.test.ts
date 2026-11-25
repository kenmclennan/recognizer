import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { nodeIo } from "../src/cli.js";
import { readResponsibilitiesOp } from "../src/serve/responsibilities-ops.js";
import { REPO } from "./helpers.js";

const EXAMPLES = join(REPO, "schema/responsibilities-examples");
const CONFIGS = join(REPO, "schema/config-examples");

const read = (dir: string, kind: string) =>
  readdirSync(join(dir, kind)).map(
    (name) => [name, readFileSync(join(dir, kind, name), "utf8")] as const,
  );

function kindsFor(
  responsibilities: string | null,
  config: string | null,
  modules: string[],
) {
  const root = makeTempDir("responsibility-examples-");

  mkdirSync(join(root, ".recognizer"), { recursive: true });

  if (responsibilities !== null) {
    writeFileSync(
      join(root, ".recognizer/responsibilities.json"),
      responsibilities,
    );
  }

  if (config !== null) {
    writeFileSync(join(root, ".recognizer/config.yaml"), config);
  }

  const { states } = readResponsibilitiesOp(
    nodeIo({ cwd: root } as never),
    root,
    modules,
  );

  return modules.map((id) => states[id].kind);
}

describe("the repository's own examples", () => {
  it.each(read(EXAMPLES, "valid"))("reads valid %s", (_, text) => {
    const modules = Object.keys(JSON.parse(text).modules);
    const config = readFileSync(join(CONFIGS, "valid/describer.yaml"), "utf8");

    for (const kind of kindsFor(text, config, ["unlisted.py", ...modules])) {
      expect(["current", "out-of-date", "missing"]).toContain(kind);
    }
  });

  it.each(read(EXAMPLES, "invalid"))(
    "reports invalid %s as unknown",
    (_, text) => {
      expect(kindsFor(text, null, ["a.py"])).toEqual(["unknown"]);
    },
  );

  it.each(read(CONFIGS, "invalid"))(
    "reports invalid config %s as unknown",
    (_, text) => {
      expect(kindsFor(null, text, ["a.py"])).toEqual(["unknown"]);
    },
  );
});
