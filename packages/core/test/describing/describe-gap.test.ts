import { describe, expect, it } from "vitest";
import { findDescribeGap } from "../../src/index.js";
import { createFakes } from "../fakes/container.js";
import { DescribingWorld, ROOT } from "./describing-world.js";

describe("the filesystem repositories plan reads", () => {
  it("reads no lines when no describer is registered", () => {
    const world = new DescribingWorld();
    const { structure } = createFakes();

    world.describer.registered = false;

    expect(
      findDescribeGap(
        {
          structure,
          describer: world.describer,
          responsibilities: world.responsibilities,
        },
        ROOT,
        ["a.py"],
      ),
    ).toBeNull();
  });
});
