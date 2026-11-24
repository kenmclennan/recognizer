import { describe, expect, it } from "vitest";
import { writeConfigEdits } from "../../src/index.js";
import { ROOT, worldOf } from "./world.js";

const json = (value: unknown) => JSON.stringify(value, null, 2);

function seeded(text: string | null) {
  const world = worldOf();

  world.fakes.config.held = text;

  return { world, hash: world.fakes.config.text().hash };
}

describe("writeConfigEdits", () => {
  it("two valid edits are saved once", () => {
    const { world, hash } = seeded(json({}));

    const outcome = writeConfigEdits(world.ports, {
      root: ROOT,
      baseHash: hash,
      edits: [
        { op: "set", key: "describer.version", value: "2" },
        { op: "add-section", key: "sensors.crap" },
      ],
    });

    const text = json({ describer: { version: "2" }, sensors: { crap: {} } });

    expect(outcome).toEqual({ status: "written", text });
    expect(world.fakes.config.saves).toEqual([text]);
  });

  it("a refused second edit saves nothing and names the key", () => {
    const { world, hash } = seeded(json({}));

    const outcome = writeConfigEdits(world.ports, {
      root: ROOT,
      baseHash: hash,
      edits: [
        { op: "set", key: "describer.version", value: "2" },
        { op: "set", key: "describer.command", value: "x" },
        { op: "set", key: "describer.version", value: "3" },
      ],
    });

    expect(outcome).toEqual({
      status: "refused",
      key: "describer.command",
      reason: "describer.command holds a list; add an item with --add",
    });
    expect(world.fakes.config.saves).toEqual([]);
    expect(world.fakes.config.held).toBe(json({}));
  });

  it("a stale base hash refuses before any edit is applied", () => {
    const { world } = seeded(json({}));

    const outcome = writeConfigEdits(world.ports, {
      root: ROOT,
      baseHash: "stale",
      edits: [{ op: "set", key: "describer.version", value: "2" }],
    });

    expect(outcome).toEqual({
      status: "changed",
      reason: "the config changed since it was read",
    });
    expect(world.fakes.config.saves).toEqual([]);
  });

  it("an absent config with one set is created", () => {
    const { world, hash } = seeded(null);

    const outcome = writeConfigEdits(world.ports, {
      root: ROOT,
      baseHash: hash,
      edits: [{ op: "set", key: "describer.version", value: "1" }],
    });

    expect(outcome).toEqual({
      status: "written",
      text: json({ describer: { version: "1" } }),
    });
    expect(world.fakes.config.saves).toHaveLength(1);
  });

  it("an unset of an absent key is not a refusal", () => {
    const { world, hash } = seeded(json({ describer: { version: "1" } }));

    const outcome = writeConfigEdits(world.ports, {
      root: ROOT,
      baseHash: hash,
      edits: [{ op: "unset", key: "describer.command" }],
    });

    expect(outcome).toEqual({
      status: "written",
      text: json({ describer: { version: "1" } }),
    });
  });

  it("a key with a separator or dots is refused before any edit", () => {
    const { world, hash } = seeded(json({}));

    for (const key of ["a/b", "a..b", "-x", "", "a b"]) {
      expect(
        writeConfigEdits(world.ports, {
          root: ROOT,
          baseHash: hash,
          edits: [{ op: "set", key, value: "1" }],
        }),
      ).toEqual({
        status: "refused",
        key,
        reason: `${key} is not a config key`,
      });
    }

    expect(world.fakes.config.saves).toEqual([]);
  });

  it("a set without a value is refused", () => {
    const { world, hash } = seeded(json({}));

    expect(
      writeConfigEdits(world.ports, {
        root: ROOT,
        baseHash: hash,
        edits: [{ op: "set", key: "describer.version" }],
      }),
    ).toEqual({
      status: "refused",
      key: "describer.version",
      reason: "a set needs a value",
    });
  });
});
