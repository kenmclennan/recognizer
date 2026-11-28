import { describe, expect, it } from "vitest";
import { sharedBuild } from "../shared-build";

describe("sharedBuild", () => {
  it("runs the build once however many callers ask at once", async () => {
    let runs = 0;
    const shared = sharedBuild(async () => {
      runs += 1;

      return "built";
    });

    const answers = await Promise.all([shared(), shared(), shared()]);

    expect(answers).toEqual(["built", "built", "built"]);
    expect(runs).toBe(1);
  });

  it("runs the build once for callers that ask one after another", async () => {
    let runs = 0;
    const shared = sharedBuild(async () => {
      runs += 1;

      return runs;
    });

    await shared();
    await shared();

    expect(runs).toBe(1);
  });

  it("hands every caller the same failure when the build fails", async () => {
    let runs = 0;
    const shared = sharedBuild(async () => {
      runs += 1;
      throw new Error("no build");
    });

    await expect(shared()).rejects.toThrow("no build");
    await expect(shared()).rejects.toThrow("no build");
    expect(runs).toBe(1);
  });
});
