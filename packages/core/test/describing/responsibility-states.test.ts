import { describe, expect, it } from "vitest";
import { InvalidRequest, readResponsibilityStates } from "../../src/index.js";
import { createFakes } from "../fakes/container.js";
import { DescribingWorld, ROOT } from "./describing-world.js";

const COMMAND = ["node", "describe.js"];

function setup(ids: string[] = ["a.py"]) {
  const world = new DescribingWorld();
  const { structure } = createFakes();

  world.describer.command = COMMAND;
  world.describer.version = "v1";
  structure.save(ROOT, "python", world.repository(...ids));

  const states = (modules: string[] = ids) =>
    readResponsibilityStates(
      {
        structure,
        describer: world.describer,
        responsibilities: world.responsibilities,
      },
      { root: ROOT, modules, describedAtMs: 42 },
    ).states;

  return { world, structure, states };
}

function entryOf(
  world: DescribingWorld,
  id: string,
  over: {
    sourceHash?: string;
    version?: string;
    command?: readonly string[];
  } = {},
) {
  const held = world.responsibilities.read(ROOT);

  held.set(id, {
    line: "Places orders.",
    sourceHash: over.sourceHash ?? `scan-${id}`,
    describer: over.command ?? COMMAND,
    version: over.version ?? "v1",
  });
  world.responsibilities.write(ROOT, held);
}

describe("responsibilityStates", () => {
  it("is current while source, describer and version match", () => {
    const { world, states } = setup();

    entryOf(world, "a.py");

    expect(states()["a.py"]).toEqual({
      kind: "current",
      line: "Places orders.",
    });
  });

  it.each([
    ["source", { sourceHash: "other" }, {}, ["source"]],
    ["describer", {}, { command: ["node", "other.js"] }, ["describer"]],
    ["version", {}, { version: "v2" }, ["version"]],
    [
      "several",
      { sourceHash: "other" },
      { command: ["x"], version: "v9" },
      ["source", "describer", "version"],
    ],
  ])("is out of date when the %s differs", (_, written, current, reasons) => {
    const { world, states } = setup();

    entryOf(world, "a.py", written);
    Object.assign(world.describer, current);

    expect(states()["a.py"]).toEqual({
      kind: "out-of-date",
      line: "Places orders.",
      reasons,
    });
  });

  it("is missing for a module without an entry, and with no file at all", () => {
    const { world, states } = setup();

    expect(states()["a.py"]).toEqual({ kind: "missing" });

    entryOf(world, "b.py");

    expect(states()["a.py"]).toEqual({ kind: "missing" });
  });

  it("is unknown for every module when a file is invalid", () => {
    const { world, states } = setup();

    world.responsibilities.invalid.set(ROOT, "responsibilities.json: bad");

    for (const id of ["a.py", "zzz.py"]) {
      expect(states(["a.py", "zzz.py"])[id]).toEqual({
        kind: "unknown",
        reason: "responsibilities.json: bad",
      });
    }

    world.responsibilities.invalid.clear();
    world.describer.locate = () => {
      throw new InvalidRequest(["config.yaml: describer must be an object"]);
    };

    for (const id of ["a.py", "zzz.py"]) {
      expect(states(["a.py", "zzz.py"])[id].kind).toBe("unknown");
    }
  });

  it("is out of date, never current, with no hash or no registered describer", () => {
    const { world, structure, states } = setup();

    entryOf(world, "a.py");
    structure.save(ROOT, "python", world.repository("other.py"));

    expect(states()["a.py"]).toEqual({
      kind: "out-of-date",
      line: "Places orders.",
      reasons: ["source"],
    });

    structure.save(ROOT, "python", world.repository("a.py"));
    world.describer.registered = false;

    expect(states()["a.py"]).toEqual({
      kind: "out-of-date",
      line: "Places orders.",
      reasons: ["describer", "version"],
    });
  });

  it("gives each module its own state and ignores modules outside the file", () => {
    const { world, states } = setup(["a.py", "b.py", "c.py"]);

    entryOf(world, "a.py");
    entryOf(world, "b.py", { sourceHash: "other" });
    entryOf(world, "gone.py");

    const read = states(["a.py", "b.py", "c.py"]);

    expect(read["a.py"].kind).toBe("current");
    expect(read["b.py"].kind).toBe("out-of-date");
    expect(read["c.py"].kind).toBe("missing");
    expect(Object.keys(read)).toEqual(["a.py", "b.py", "c.py"]);
  });

  it("answers the time the responsibilities file was written", () => {
    const { states, world, structure } = setup();

    const view = readResponsibilityStates(
      {
        structure,
        describer: world.describer,
        responsibilities: world.responsibilities,
      },
      { root: ROOT, modules: [], describedAtMs: 42 },
    );

    expect(view.describedAtMs).toBe(42);
    expect(states()).toBeDefined();
  });
});

describe("responsibilityStates and the model", () => {
  const withVersion = (
    recorded: string,
    current: string,
    command: string[],
  ) => {
    const { world, states } = setup();

    entryOf(world, "a.py", { version: recorded, command });
    world.describer.command = command;
    world.describer.version = current;

    return states()["a.py"];
  };

  it("is current under the model that wrote the line", () => {
    expect(withVersion("v1+sonnet", "v1", ["d", "--model", "{model}"])).toEqual(
      { kind: "current", line: "Places orders." },
    );
  });

  it("is out of date for version when the base version changed", () => {
    expect(withVersion("v1+sonnet", "v2", ["d", "--model", "{model}"])).toEqual(
      { kind: "out-of-date", line: "Places orders.", reasons: ["version"] },
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
    const { world, states } = setup();

    entryOf(world, "a.py");

    expect(states()["a.py"].kind).toBe("current");
  });

  it("takes the fallback's version as already effective", () => {
    const { world, states } = setup();

    world.describer.command = ["d", "{model}"];
    entryOf(world, "a.py", { command: ["d", "{model}"] });

    expect(states()["a.py"].kind).toBe("current");
  });
});

describe("responsibilityStates with the describer in effect", () => {
  const command = ["quill-describe", "--model", "{model}", "{request}"];

  it("treats a line written by the fallback as current when no config describer exists", () => {
    const { world, states } = setup();

    world.describer.command = command;
    world.describer.version = "p1+sonnet";
    entryOf(world, "a.py", { command, version: "p1+sonnet" });

    expect(states()["a.py"].kind).toBe("current");
  });

  it("treats it as out of date when no describer is in effect", () => {
    const { world, states } = setup();

    entryOf(world, "a.py", { command, version: "p1+sonnet" });
    world.describer.registered = false;

    expect(states()["a.py"].kind).toBe("out-of-date");
  });
});
