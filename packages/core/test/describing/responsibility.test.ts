import { describe, expect, it } from "vitest";
import { lineStatus } from "../../src/index.js";

const HASH = "a".repeat(64);
const entry = {
  line: "Places orders.",
  sourceHash: HASH,
  describer: ["node", "x"],
  version: "v1",
};

describe("lineStatus", () => {
  it("is missing without an entry", () => {
    expect(lineStatus(undefined, HASH, ["node", "x"], "v1")).toEqual({
      status: "missing",
    });
  });

  it("is current while hash, describer and version match", () => {
    expect(lineStatus(entry, HASH, ["node", "x"], "v1")).toEqual({
      status: "current",
    });
  });

  it("lists every differing reason in order", () => {
    expect(lineStatus(entry, "b".repeat(64), ["node", "y"], "v2")).toEqual({
      status: "out-of-date",
      reasons: ["source", "describer", "version"],
    });
  });
});

describe("lineStatus and the recorded model", () => {
  const recorded = (version: string, command: string[]) => ({
    line: "Places orders.",
    sourceHash: "h",
    describer: command,
    version,
  });
  const named = ["x", "--model", "{model}", "{request}"];

  it("keeps a v1+sonnet line current for a {model} command", () => {
    expect(lineStatus(recorded("v1+sonnet", named), "h", named, "v1")).toEqual({
      status: "current",
    });
  });

  it("outdates a v1+sonnet line for a command without {model}", () => {
    expect(lineStatus(recorded("v1+sonnet", ["x"]), "h", ["x"], "v1")).toEqual({
      status: "out-of-date",
      reasons: ["version"],
    });
  });

  it("outdates a line whose base version or source changed", () => {
    expect(lineStatus(recorded("v1+sonnet", named), "h", named, "v2")).toEqual({
      status: "out-of-date",
      reasons: ["version"],
    });
    expect(lineStatus(recorded("v1+sonnet", named), "z", named, "v1")).toEqual({
      status: "out-of-date",
      reasons: ["source"],
    });
  });
});
