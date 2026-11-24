import { describe, expect, it } from "vitest";
import { type EditKeyRequest, editKey } from "../../src/index.js";
import { ROOT, worldOf } from "./world.js";

const config = (verb: EditKeyRequest["verb"], key: string, value?: string) =>
  ({
    subject: "config",
    root: ROOT,
    verb,
    key,
    ...(value === undefined ? {} : { value }),
  }) as EditKeyRequest;

const policy = (verb: EditKeyRequest["verb"], key: string, value?: string) =>
  ({ ...config(verb, key, value), subject: "policy" }) as EditKeyRequest;

function seeded(text: string | null = null) {
  const world = worldOf();

  world.fakes.config.held = text;

  return world;
}

const json = (value: unknown) => JSON.stringify(value, null, 2);

describe("editKey", () => {
  it("sets a scalar and saves the text once", () => {
    const world = seeded();

    expect(
      editKey(world.ports, config("set", "describer.version", "2")),
    ).toEqual({ status: "ok", lines: [] });
    expect(world.fakes.config.saves).toEqual([
      json({ describer: { version: "2" } }),
    ]);
  });

  it("adds an item to a list key and does not repeat it", () => {
    const world = seeded(json({ describer: { command: ["a"] } }));

    editKey(world.ports, config("add", "describer.command", "b"));
    editKey(world.ports, config("add", "describer.command", "b"));

    expect(world.fakes.config.saves).toEqual([
      json({ describer: { command: ["a", "b"] } }),
    ]);
  });

  it("reads a key and answers absent for one that is not set", () => {
    const world = seeded(json({ describer: { command: ["a", "b"] } }));

    expect(editKey(world.ports, config("get", "describer.command"))).toEqual({
      status: "ok",
      lines: ["a", "b"],
    });
    expect(editKey(world.ports, config("get", "describer.version"))).toEqual({
      status: "absent",
    });
  });

  it("lists every set key", () => {
    const world = seeded(json({ describer: { version: "1", command: ["a"] } }));

    expect(editKey(world.ports, config("list", ""))).toEqual({
      status: "ok",
      lines: ["describer.version=1", "describer.command=a"],
    });
  });

  it("unsets a key, and an unset of an absent key is absent and saves nothing", () => {
    const world = seeded(json({ describer: { version: "1" } }));

    expect(editKey(world.ports, config("unset", "describer.version"))).toEqual({
      status: "ok",
      lines: [],
    });
    expect(editKey(world.ports, config("unset", "describer.version"))).toEqual({
      status: "absent",
    });
    expect(world.fakes.config.saves).toHaveLength(1);
  });

  it("adds and removes a section", () => {
    const world = seeded(json({}));

    editKey(world.ports, config("add-section", "sensors.crap"));

    expect(world.fakes.config.held).toBe(json({ sensors: { crap: {} } }));

    editKey(world.ports, config("remove-section", "sensors.crap"));

    expect(world.fakes.config.held).toBe(json({ sensors: {} }));
  });

  it("refuses a retired key with its message", () => {
    const world = seeded(json({}));
    const outcome = editKey(world.ports, config("set", "overlays.x", "x"));

    expect(outcome).toMatchObject({
      status: "refused",
      key: "overlays.x",
      suffix: "",
    });
    expect((outcome as { reason: string }).reason).toContain(
      "config/overlays is retired",
    );
    expect(world.fakes.config.saves).toEqual([]);
  });

  it("refuses a set on a key that holds a list", () => {
    const world = seeded(json({}));

    expect(
      editKey(world.ports, config("set", "describer.command", "x")),
    ).toMatchObject({
      status: "refused",
      reason: "describer.command holds a list; add an item with --add",
    });
  });

  it("refuses a command on a registration that holds settings and the reverse", () => {
    const world = seeded(json({ sensors: { mine: { threshold: 1 } } }));

    expect(
      editKey(world.ports, config("add", "sensors.mine.command", "mine")),
    ).toMatchObject({
      status: "refused",
      reason:
        "sensors.mine holds settings; a registration is either settings or a command",
    });

    world.fakes.keyOwners.schema = {
      ...world.fakes.keyOwners.schema,
      keys: [
        {
          key: "sensors.mine.threshold",
          type: "integer",
          description: "d",
          example: "e",
        },
      ],
    };
    world.fakes.config.held = json({ sensors: { mine: { command: ["m"] } } });

    expect(
      editKey(world.ports, config("set", "sensors.mine.threshold", "3")),
    ).toMatchObject({
      status: "refused",
      reason:
        "sensors.mine is registered with a command; a registration is either settings or a command",
    });
  });

  it("refuses a path through a scalar", () => {
    const world = seeded(json({ describer: "x" }));

    expect(
      editKey(world.ports, config("set", "describer.version", "1")),
    ).toMatchObject({
      status: "refused",
      reason: "describer is a scalar, not a section",
    });
  });

  it("does not save an edit that changes nothing", () => {
    const world = seeded(json({ describer: { version: "1" } }));

    expect(editKey(world.ports, config("get", "describer.version"))).toEqual({
      status: "ok",
      lines: ["1"],
    });
    expect(
      editKey(world.ports, config("set", "describer.version", "1")),
    ).toEqual({ status: "ok", lines: [] });
    expect(world.fakes.config.saves).toEqual([]);
  });

  it("saves an unchanged edit when the file is absent", () => {
    const world = seeded(null);

    editKey(world.ports, config("add-section", "sensors.crap"));

    expect(world.fakes.config.saves).toHaveLength(1);
  });

  it("names the sensors that did not answer on a no such key refusal", () => {
    const world = seeded(json({}));

    world.fakes.keyOwners.notAnswering = ["crap did not answer: x"];

    expect(editKey(world.ports, config("set", "nope", "1"))).toEqual({
      status: "refused",
      key: "nope",
      reason: "no such key",
      suffix: "; crap did not answer: x",
    });
  });

  it("refuses a policy edit that introduces a problem the original lacked", () => {
    const world = worldOf();
    const edited = json({ ignore: ["a"] });

    world.fakes.policy.heldText = json({});
    world.fakes.policy.problemsByText.set(edited, ["policy: ignore is bad"]);

    expect(editKey(world.ports, policy("add", "ignore", "a"))).toEqual({
      status: "refused",
      key: "ignore",
      reason: "policy: ignore is bad",
      suffix: "",
    });
    expect(world.fakes.policy.saves).toEqual([]);
  });

  it("accepts a policy edit that keeps a problem the original already had", () => {
    const world = worldOf();
    const original = json({ entry: ["a"] });
    const edited = json({ entry: ["a"], ignore: ["b"] });

    world.fakes.policy.heldText = original;
    world.fakes.policy.problemsByText.set(original, ["policy: old"]);
    world.fakes.policy.problemsByText.set(edited, ["policy: old"]);

    expect(editKey(world.ports, policy("add", "ignore", "b"))).toEqual({
      status: "ok",
      lines: [],
    });
    expect(world.fakes.policy.saves).toEqual([edited]);
  });

  it("reports a missing policy for a read and creates it for a write", () => {
    const world = worldOf();

    expect(editKey(world.ports, policy("get", "entry"))).toEqual({
      status: "missing",
      reason: "there is no policy at .recognizer/policy.yaml",
    });
    expect(editKey(world.ports, policy("add", "entry", "a"))).toEqual({
      status: "ok",
      lines: [],
    });
    expect(world.fakes.policy.saves).toEqual([json({ entry: ["a"] })]);
  });
});
