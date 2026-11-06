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
    const state = responsibilityStates(
      files({ "a.py": entry() }),
      null,
    )("a.py");

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
    const state = responsibilityStates(
      files({ "a.py": entry() }, extra),
      null,
    )("a.py");

    expect(state).toEqual({
      kind: "out-of-date",
      line: "Places orders.",
      reasons,
    });
  });

  it("is missing for a module without an entry, and with no file at all", () => {
    expect(responsibilityStates(files({}), null)("a.py")).toEqual({
      kind: "missing",
    });
    expect(responsibilityStates(NO_FILES, null)("a.py")).toEqual({
      kind: "missing",
    });
  });

  it("is unknown for every module when a file is invalid", () => {
    const badJson = responsibilityStates(
      {
        ...files({ "a.py": entry() }),
        responsibilities: "not json",
      },
      null,
    );
    const badShape = responsibilityStates(
      {
        ...files({ "a.py": entry() }),
        responsibilities: '{"schema_version":2,"modules":{}}',
      },
      null,
    );
    const badConfig = responsibilityStates(
      {
        ...files({ "a.py": entry() }),
        config: "describer: 4",
      },
      null,
    );

    for (const states of [badJson, badShape, badConfig]) {
      expect(states("a.py").kind).toBe("unknown");
      expect(states("zzz.py").kind).toBe("unknown");
    }
  });

  it("is out of date, never current, with no hash or no registered describer", () => {
    const noHash = responsibilityStates(
      files({ "a.py": entry() }, { hashes: {} }),
      null,
    )("a.py");
    const noDescriber = responsibilityStates(
      files({ "a.py": entry() }, { config: null }),
      null,
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
      null,
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
    const states = responsibilityStates(
      {
        ...NO_FILES,
        responsibilities: text,
        config: readFileSync(join(CONFIGS, "valid/describer.yaml"), "utf8"),
      },
      null,
    );
    const modules = Object.keys(JSON.parse(text).modules);

    for (const id of ["unlisted.py", ...modules]) {
      expect(["current", "out-of-date", "missing"]).toContain(states(id).kind);
    }
  });

  it.each(read(EXAMPLES, "invalid"))(
    "reports invalid %s as unknown",
    (_, text) => {
      const states = responsibilityStates(
        {
          ...NO_FILES,
          responsibilities: text,
        },
        null,
      );

      expect(states("a.py").kind).toBe("unknown");
    },
  );

  it.each(read(CONFIGS, "invalid"))(
    "reports invalid config %s as unknown",
    (_, text) => {
      const states = responsibilityStates({ ...NO_FILES, config: text }, null);

      expect(states("a.py").kind).toBe("unknown");
    },
  );
});

describe("responsibilityStates and the model", () => {
  const withVersion = (recorded: string, current: string, command: string[]) =>
    responsibilityStates(
      files(
        { "a.py": entry(HASH, command, recorded) },
        { config: config(command, current) },
      ),
      null,
    )("a.py");

  it("is current under the model that wrote the line", () => {
    expect(withVersion("v1+sonnet", "v1", ["d", "--model", "{model}"])).toEqual(
      {
        kind: "current",
        line: "Places orders.",
      },
    );
  });

  it("is out of date for version when the base version changed", () => {
    expect(withVersion("v1+sonnet", "v2", ["d", "--model", "{model}"])).toEqual(
      {
        kind: "out-of-date",
        line: "Places orders.",
        reasons: ["version"],
      },
    );
  });

  it("is out of date for a recorded model suffix when the command has no {model}", () => {
    expect(withVersion("v1+sonnet", "v1", ["d"])).toEqual({
      kind: "out-of-date",
      line: "Places orders.",
      reasons: ["version"],
    });
  });

  it("is out of date for version under another model", () => {
    expect(withVersion("v1+opus", "v1", ["d", "--model", "{model}"]).kind).toBe(
      "current",
    );
  });

  it("ignores the model for a describer whose command has no {model}", () => {
    const states = responsibilityStates(files({ "a.py": entry() }), null);

    expect(states("a.py").kind).toBe("current");
  });

  it("takes the fallback's version as already effective", () => {
    const states = responsibilityStates(
      files({ "a.py": entry(HASH, ["d", "{model}"], "v1") }, { config: null }),
      { command: ["d", "{model}"], version: "v1" },
    );

    expect(states("a.py").kind).toBe("current");
  });
});

describe("createDescribing", () => {
  it("holds a failure until the module reads current", () => {
    const describing = createDescribing();

    describing.finish("a.py", { status: "failed", reason: "timed out" });

    expect(describing.failure("a.py")).toBe("timed out");

    describing.read(() => ({ kind: "missing" }));

    expect(describing.failure("a.py")).toBe("timed out");

    describing.read(() => ({ kind: "current", line: "x" }));

    expect(describing.failure("a.py")).toBeNull();
  });
});

describe("responsibilityStates with the describer in effect", () => {
  const fallback = {
    command: ["recognizer-describe-claude", "--model", "{model}", "{request}"],
    version: "p1+sonnet",
  };
  const written = files(
    { "a.py": entry(HASH, fallback.command, "p1+sonnet") },
    { config: null },
  );

  it("treats a line written by the fallback as current when no config describer exists", () => {
    expect(responsibilityStates(written, fallback)("a.py").kind).toBe(
      "current",
    );
  });

  it("treats it as out of date when no describer is in effect", () => {
    expect(responsibilityStates(written, null)("a.py").kind).toBe(
      "out-of-date",
    );
  });
});
