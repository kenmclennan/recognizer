import { describe, expect, it } from "vitest";
import { describerVersion } from "../src/describer-version.js";
import { lineStatus } from "../src/responsibilities.js";

describe("describerVersion", () => {
  it("appends the model when the command names {model}", () => {
    expect(
      describerVersion({
        command: ["x", "--model", "{model}", "{request}"],
        version: "v1",
      }),
    ).toBe("v1");
    expect(
      describerVersion({ command: ["x", "--m={model}"], version: "v1" }),
    ).toBe("v1");
  });

  it("leaves the version alone when the command ignores the model", () => {
    expect(
      describerVersion({ command: ["x", "{request}"], version: "v1" }),
    ).toBe("v1");
  });
});

describe("lineStatus and the recorded model", () => {
  const entry = (version: string, command: string[]) => ({
    line: "Places orders.",
    source_hash: "h",
    describer: command,
    version,
  });
  const named = ["x", "--model", "{model}", "{request}"];

  it("keeps a v1+sonnet line current for a {model} command", () => {
    expect(lineStatus(entry("v1+sonnet", named), "h", named, "v1")).toEqual({
      status: "current",
    });
  });

  it("outdates a v1+sonnet line for a command without {model}", () => {
    expect(lineStatus(entry("v1+sonnet", ["x"]), "h", ["x"], "v1")).toEqual({
      status: "out-of-date",
      reasons: ["version"],
    });
  });

  it("outdates a line whose base version or source changed", () => {
    expect(lineStatus(entry("v1+sonnet", named), "h", named, "v2")).toEqual({
      status: "out-of-date",
      reasons: ["version"],
    });
    expect(lineStatus(entry("v1+sonnet", named), "z", named, "v1")).toEqual({
      status: "out-of-date",
      reasons: ["source"],
    });
  });
});
