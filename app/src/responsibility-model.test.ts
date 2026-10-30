import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createDescribing,
  NO_FILES,
  type ResponsibilityFiles,
  responsibilityStates,
} from "./responsibility-model";

const HASH = "a".repeat(64);
const OTHER = "b".repeat(64);
const COMMAND = ["node", "describe.js"];
const entry = (hash = HASH, command = COMMAND, version = "v1") => ({
  line: "Places orders.",
  source_hash: hash,
  describer: command,
  version,
});
const config = (command = COMMAND, version = "v1") =>
  `describer:\n  command: ${JSON.stringify(command)}\n  version: ${version}\n`;
const files = (
  modules: Record<string, ReturnType<typeof entry>>,
  extra: Partial<ResponsibilityFiles> = {},
): ResponsibilityFiles => ({
  responsibilities: JSON.stringify({ schema_version: 1, modules }),
  config: config(),
  refused: [],
  hashes: Object.fromEntries(Object.keys(modules).map((id) => [id, HASH])),
  ...extra,
});

describe("responsibilityStates", () => {
  it("is current while source, describer and version match", () => {
    const state = responsibilityStates(files({ "a.py": entry() }))("a.py");

    expect(state).toEqual({ kind: "current", line: "Places orders." });
  });

  it.each([
    ["source", { hashes: { "a.py": OTHER } }, ["source"]],
    ["describer", { config: config(["node", "other.js"]) }, ["describer"]],
    ["version", { config: config(COMMAND, "v2") }, ["version"]],
    [
      "several",
      { hashes: { "a.py": OTHER }, config: config(["x"], "v9") },
      ["source", "describer", "version"],
    ],
  ])("is out of date when the %s differs", (_, extra, reasons) => {
    const state = responsibilityStates(files({ "a.py": entry() }, extra))(
      "a.py",
    );

    expect(state).toEqual({
      kind: "out-of-date",
      line: "Places orders.",
      reasons,
    });
  });

  it("is missing for a module without an entry, and with no file at all", () => {
    expect(responsibilityStates(files({}))("a.py")).toEqual({
      kind: "missing",
    });
    expect(responsibilityStates(NO_FILES)("a.py")).toEqual({
      kind: "missing",
    });
  });

  it("is unknown for every module when a file is invalid", () => {
    const badJson = responsibilityStates({
      ...files({ "a.py": entry() }),
      responsibilities: "not json",
    });
    const badShape = responsibilityStates({
      ...files({ "a.py": entry() }),
      responsibilities: '{"schema_version":2,"modules":{}}',
    });
    const badConfig = responsibilityStates({
      ...files({ "a.py": entry() }),
      config: "describer: 4",
    });

    for (const states of [badJson, badShape, badConfig]) {
      expect(states("a.py").kind).toBe("unknown");
      expect(states("zzz.py").kind).toBe("unknown");
    }
  });

  it("is out of date, never current, with no hash or no registered describer", () => {
    const noHash = responsibilityStates(
      files({ "a.py": entry() }, { hashes: {} }),
    )("a.py");
    const noDescriber = responsibilityStates(
      files({ "a.py": entry() }, { config: null }),
    )("a.py");

    expect(noHash).toEqual({
      kind: "out-of-date",
      line: "Places orders.",
      reasons: ["source"],
    });
    expect(noDescriber).toEqual({
      kind: "out-of-date",
      line: "Places orders.",
      reasons: ["describer", "version"],
    });
  });

  it("gives each module its own state and ignores modules outside the file", () => {
    const states = responsibilityStates(
      files(
        { "a.py": entry(), "b.py": entry(OTHER), "gone.py": entry() },
        { hashes: { "a.py": HASH, "b.py": HASH, "gone.py": HASH } },
      ),
    );

    expect(states("a.py").kind).toBe("current");
    expect(states("b.py").kind).toBe("out-of-date");
    expect(states("c.py").kind).toBe("missing");
  });
});

describe("the repository's own examples", () => {
  const EXAMPLES = join(__dirname, "../../schema/responsibilities-examples");
  const CONFIGS = join(__dirname, "../../schema/config-examples");
  const read = (dir: string, kind: string) =>
    readdirSync(join(dir, kind)).map(
      (name) => [name, readFileSync(join(dir, kind, name), "utf8")] as const,
    );

  it.each(read(EXAMPLES, "valid"))("reads valid %s", (_, text) => {
    const states = responsibilityStates({
      ...NO_FILES,
      responsibilities: text,
      config: readFileSync(join(CONFIGS, "valid/describer.yaml"), "utf8"),
    });
    const modules = Object.keys(JSON.parse(text).modules);

    for (const id of ["unlisted.py", ...modules]) {
      expect(["current", "out-of-date", "missing"]).toContain(states(id).kind);
    }
  });

  it.each(read(EXAMPLES, "invalid"))(
    "reports invalid %s as unknown",
    (_, text) => {
      const states = responsibilityStates({
        ...NO_FILES,
        responsibilities: text,
      });

      expect(states("a.py").kind).toBe("unknown");
    },
  );

  it.each(read(CONFIGS, "invalid"))(
    "reports invalid config %s as unknown",
    (_, text) => {
      const states = responsibilityStates({ ...NO_FILES, config: text });

      expect(states("a.py").kind).toBe("unknown");
    },
  );
});

describe("createDescribing", () => {
  it("allows one run per module at a time", () => {
    const describing = createDescribing();

    expect(describing.start("a.py")).toBe(true);
    expect(describing.start("a.py")).toBe(false);
    expect(describing.start("b.py")).toBe(true);
    expect(describing.busy("a.py")).toBe(true);

    describing.finish("a.py", { status: "described" });

    expect(describing.busy("a.py")).toBe(false);
    expect(describing.start("a.py")).toBe(true);
  });

  it("holds a failure until the module reads current", () => {
    const describing = createDescribing();

    describing.start("a.py");
    describing.finish("a.py", { status: "failed", reason: "timed out" });

    expect(describing.failure("a.py")).toBe("timed out");

    describing.read(() => ({ kind: "missing" }));

    expect(describing.failure("a.py")).toBe("timed out");

    describing.read(() => ({ kind: "current", line: "x" }));

    expect(describing.failure("a.py")).toBeNull();
  });
});
