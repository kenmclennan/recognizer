import { describe, expect, it } from "vitest";
import { measureModules } from "../src/application/analysis/measure-modules.js";
import { edge, repositoryWith } from "./fakes/dependency-of.js";

describe("module metrics beside a supertype edge", () => {
  it("dropping a depends edge beside a same-pair implements edge leaves fan-in, fan-out and instability unchanged", () => {
    const paths = ["impl.kt", "contract.kt"];
    const doubled = measureModules(
      repositoryWith(paths, [
        edge("impl.kt", "contract.kt", 2, "depends"),
        edge("impl.kt", "contract.kt", 2, "implements"),
      ]),
    );
    const single = measureModules(
      repositoryWith(paths, [edge("impl.kt", "contract.kt", 2, "implements")]),
    );
    const impl = doubled.metrics.find((m) => m.id === "impl.kt");

    expect(impl?.fan_out).toBe(1);
    expect(single.metrics.find((m) => m.id === "impl.kt")?.fan_out).toBe(1);
    expect(single.metrics).toEqual(doubled.metrics);
  });
});
