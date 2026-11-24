import { describe, expect, it } from "vitest";
import { InvalidRequest, readDescriber } from "../../src/index.js";
import { DescribingWorld, ROOT } from "./describing-world.js";

describe("readDescriber", () => {
  it("gives the command, version and a config source for a registered describer", () => {
    const world = new DescribingWorld();

    expect(readDescriber(world.ports, ROOT)).toEqual({
      command: ["quill", "run", "{module}"],
      version: "v1",
      source: "config",
    });
  });

  it("names the shipped source when only the shipped describer is found", () => {
    const world = new DescribingWorld();

    world.describer.shipped = true;

    expect(readDescriber(world.ports, ROOT).source).toBe("shipped");
  });

  it("refuses with the none-registered message naming the shipped program", () => {
    const world = new DescribingWorld();

    world.describer.registered = false;

    expect(() => readDescriber(world.ports, ROOT)).toThrow(InvalidRequest);
    expect(() => readDescriber(world.ports, ROOT)).toThrow(
      "no describer is registered: add one to .recognizer/config.yaml and quill-describe-claude is not installed",
    );
  });
});
