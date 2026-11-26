import type { StructureSettings } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { resolveStructureSettings } from "../src/structure-sensor.js";

describe("the structure settings", () => {
  it("resolve the complexity switch and limit like long_function", () => {
    const resolve = (text: string) => {
      const config = {
        sensors: { structure: JSON.parse(text) },
      } as Parameters<typeof resolveStructureSettings>[0];

      return resolveStructureSettings(config) as StructureSettings;
    };

    expect(resolve("{}").complexity_limit).toBe(10);
    expect(resolve("{}").warnings.complexity).toBe(true);
    expect(
      resolve('{"warnings":{"complexity":{"limit":15}}}').complexity_limit,
    ).toBe(15);
    expect(
      resolve('{"warnings":{"complexity":false}}').warnings.complexity,
    ).toBe(false);
  });
});
