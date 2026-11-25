import { describe, expect, it } from "vitest";
import { createDescribing } from "../../src/responsibility-model";

describe("createDescribing", () => {
  it("holds a failure until the module reads current", () => {
    const describing = createDescribing();

    describing.finish("a.py", { status: "failed", reason: "timed out" });

    expect(describing.failure("a.py")).toBe("timed out");

    describing.read(() => ({ kind: "missing" }));

    expect(describing.failure("a.py")).toBe("timed out");

    describing.read(() => ({ kind: "current", line: "x" }));

    expect(describing.failure("a.py")).toBeNull();
  });
});
