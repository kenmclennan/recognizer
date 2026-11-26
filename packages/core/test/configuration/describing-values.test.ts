import { describe, expect, it } from "vitest";
import {
  describingProblem,
  describingValues,
  machineSetting,
  publishedModel,
  setupProblem,
  setupValues,
} from "../../src/index.js";

const batch = machineSetting("describing.batch_size");
const spend = machineSetting("describing.confirm_above_usd");
const setup = machineSetting("setup.model");

describe("describingValues", () => {
  it("gives core's defaults and the published model when nothing is stored", () => {
    expect(describingValues({}, { model: "published" })).toEqual({
      model: "published",
      batch_size: batch.default,
      confirm_above_usd: spend.default,
    });
  });

  it("prefers a stored model over the published one", () => {
    expect(
      describingValues({ model: "mine" }, { model: "published" }),
    ).toMatchObject({
      model: "mine",
    });
  });

  it("reads an unknown model as null", () => {
    expect(describingValues({}, { model: null }).model).toBeNull();
  });

  it("mixes a stored batch size with the default threshold", () => {
    expect(describingValues({ batch_size: 9 }, { model: null })).toMatchObject({
      batch_size: 9,
      confirm_above_usd: spend.default,
    });
  });
});

describe("describingProblem", () => {
  it.each([
    ["batch_size", batch.maximum as number],
    ["confirm_above_usd", spend.maximum as number],
  ])("accepts the maximum of %s and refuses one above it", (key, maximum) => {
    expect(describingProblem({ [key]: maximum })).toBeNull();
    expect(describingProblem({ [key]: maximum + 1 })).toContain(
      `describing.${key}`,
    );
  });

  it("refuses a present non-number naming the key", () => {
    expect(describingProblem({ batch_size: "x" })).toMatch(
      /^describing\.batch_size/,
    );
    expect(describingProblem({ confirm_above_usd: "x" })).toMatch(
      /^describing\.confirm_above_usd/,
    );
  });

  it("accepts an object with nothing stored", () => {
    expect(describingProblem({})).toBeNull();
  });
});

describe("setup values", () => {
  it("defaults the model to core's entry and keeps a stored one", () => {
    expect(setupValues({})).toEqual({ model: setup.default });
    expect(setupValues({ model: "mine" })).toEqual({ model: "mine" });
  });

  it("refuses a bad model and accepts none", () => {
    expect(setupProblem({})).toBeNull();
    expect(setupProblem({ model: "a b" })).toMatch(/^setup\.model/);
  });
});

describe("publishedModel", () => {
  it("returns the default of a machine model setting", () => {
    expect(
      publishedModel([{ key: "model", scope: "machine", default: "m" }]),
    ).toBe("m");
  });

  it("returns null with no model setting or a default that is not a string", () => {
    expect(
      publishedModel([{ key: "other", scope: "machine", default: "m" }]),
    ).toBeNull();
    expect(publishedModel([])).toBeNull();
    expect(
      publishedModel([{ key: "model", scope: "machine", default: 3 }]),
    ).toBeNull();
    expect(publishedModel([{ key: "model", default: "m" }])).toBeNull();
  });
});
