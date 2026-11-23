import { describe, expect, it } from "vitest";
import { expandShortForms } from "../../src/index.js";
import { FakeShippedPlugins } from "../fakes/fake-shipped-plugins.js";

function shippedWith(names: string[]): FakeShippedPlugins {
  const fake = new FakeShippedPlugins();

  fake.sensorNames = names;

  return fake;
}

describe("expandShortForms over the shipped port", () => {
  it("turns a settings mapping into a command only when the port holds the name", () => {
    const shipped = shippedWith(["alpha"]);
    const expanded = expandShortForms(
      { alpha: { limit: 2 }, other: { limit: 2 } },
      shipped.sensors(),
    ) as Record<string, { command?: string[]; limit?: number }>;

    expect(expanded.alpha?.command?.[0]).toBe("recognizer-sense-alpha");
    expect(expanded.alpha?.command?.at(-1)).toBe('{"limit":2}');
    expect(expanded.other).toEqual({ limit: 2 });
  });

  it("leaves an entry that already holds a command alone", () => {
    const entries = { alpha: { command: ["mine", "run"] } };

    expect(expandShortForms(entries, shippedWith(["alpha"]).sensors())).toEqual(
      entries,
    );
  });

  it("leaves everything alone when the port is seeded with no names", () => {
    const entries = { alpha: { limit: 2 } };

    expect(expandShortForms(entries, shippedWith([]).sensors())).toEqual(
      entries,
    );
  });

  it("returns empty lists from an unseeded fake, never a built-in default", () => {
    const fake = new FakeShippedPlugins();

    expect([fake.sensors(), fake.describers(), fake.scanners()]).toEqual([
      [],
      [],
      [],
    ]);
  });
});
