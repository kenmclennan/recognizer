import { describe, expect, it } from "vitest";
import { principleName } from "../../src/domain/principles.js";

const published = [
  { id: "published-id", name: "A published name" },
  { id: "dead-code", name: "Not core's name" },
];

describe("principleName", () => {
  it("returns a core name for a core id", () => {
    expect(principleName("dead-code")).toBe("Dead code");
    expect(principleName("dead-code")).not.toBe("dead-code");
  });

  it("returns a published name for a published id", () => {
    expect(principleName("published-id", published)).toBe("A published name");
    expect(principleName("published-id", published)).not.toBe("published-id");
  });

  it("returns the id for an unknown one", () => {
    expect(principleName("unknown-id", published)).toBe("unknown-id");
  });

  it("returns core's name when a published entry repeats a core id", () => {
    expect(principleName("dead-code", published)).toBe("Dead code");
  });
});
