import { describe, expect, it } from "vitest";
import { addForbid, migratePolicy } from "../../src/index.js";
import { ROOT, worldOf } from "./world.js";

const json = (value: unknown) => JSON.stringify(value, null, 2);

describe("migratePolicy", () => {
  it("lists the changes it made and saves the rewritten policy", () => {
    const world = worldOf();

    world.fakes.policy.heldText = json({
      components: { a: "src/a/**", b: "src/b/**" },
      levels: ["a", "b"],
    });

    expect(migratePolicy(world.ports, { root: ROOT })).toEqual({
      status: "migrated",
      changes: ["removed components, levels", "forbid: src/a/** -> src/b/**"],
    });
    expect(world.fakes.policy.saves).toEqual([
      json({ forbid: [{ from: ["src/a/**"], to: ["src/b/**"] }] }),
    ]);
  });

  it("reports unchanged and writes nothing for a policy with no retired key", () => {
    const world = worldOf();

    world.fakes.policy.heldText = json({ entry: ["a"] });

    expect(migratePolicy(world.ports, { root: ROOT })).toEqual({
      status: "unchanged",
    });
    expect(world.fakes.policy.saves).toEqual([]);
  });

  it("reports missing for no policy", () => {
    const world = worldOf();

    expect(migratePolicy(world.ports, { root: ROOT })).toEqual({
      status: "missing",
      reason: "there is no policy at .recognizer/policy.yaml",
    });
  });

  it("refuses a policy that is not valid and one whose retired keys are malformed", () => {
    const world = worldOf();

    world.fakes.policy.heldText = "{nope";

    expect(migratePolicy(world.ports, { root: ROOT })).toMatchObject({
      status: "refused",
      messages: [expect.stringMatching(/^policy is not valid YAML: /)],
    });

    world.fakes.policy.heldText = json({ levels: [] });

    expect(migratePolicy(world.ports, { root: ROOT })).toEqual({
      status: "refused",
      messages: ["levels: must be a non-empty list of component names"],
    });
    expect(world.fakes.policy.saves).toEqual([]);
  });
});

describe("addForbid", () => {
  const rule = { from: ["a/**"], to: ["b/**"] };

  it("adds a rule", () => {
    const world = worldOf();

    world.fakes.policy.heldText = json({});

    expect(addForbid(world.ports, { root: ROOT, ...rule })).toEqual({
      status: "added",
    });
    expect(world.fakes.policy.saves).toEqual([json({ forbid: [rule] })]);
  });

  it("treats the same globs as a duplicate and writes nothing", () => {
    const world = worldOf();

    world.fakes.policy.heldText = json({ forbid: [rule] });

    expect(addForbid(world.ports, { root: ROOT, ...rule })).toEqual({
      status: "duplicate",
    });
    expect(world.fakes.policy.saves).toEqual([]);
  });

  it("refuses invalid YAML and a rule that introduces a problem", () => {
    const world = worldOf();

    world.fakes.policy.heldText = "{nope";

    expect(addForbid(world.ports, { root: ROOT, ...rule })).toMatchObject({
      status: "invalid-yaml",
    });

    world.fakes.policy.heldText = json({});
    world.fakes.policy.problemsByText.set(json({ forbid: [rule] }), [
      "policy: bad rule",
    ]);

    expect(addForbid(world.ports, { root: ROOT, ...rule })).toEqual({
      status: "refused",
      reason: "policy: bad rule",
    });
    expect(world.fakes.policy.saves).toEqual([]);
  });
});
