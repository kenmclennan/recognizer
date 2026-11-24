import { describe, expect, it } from "vitest";
import {
  InvalidRequest,
  noneRegistered,
  readDescriber,
} from "../../src/index.js";
import { DescribingWorld, ROOT } from "./describing-world.js";

describe("readDescriber", () => {
  it("gives the command and version of a registered describer", () => {
    const world = new DescribingWorld();

    expect(readDescriber(world.ports, ROOT)).toEqual({
      command: ["quill", "run", "{module}"],
      version: "v1",
    });
  });

  it("refuses with the none-registered message", () => {
    const world = new DescribingWorld();

    world.describer.registered = false;

    expect(() => readDescriber(world.ports, ROOT)).toThrow(InvalidRequest);
    expect(() => readDescriber(world.ports, ROOT)).toThrow(noneRegistered());
  });
});
