import { describe, expect, it } from "vitest";
import { describerVersion } from "../src/describer-version.js";

describe("describerVersion", () => {
  it("appends the model when the command names {model}", () => {
    expect(
      describerVersion(
        { command: ["x", "--model", "{model}", "{request}"], version: "v1" },
        "opus",
      ),
    ).toBe("v1+opus");
    expect(
      describerVersion({ command: ["x", "--m={model}"], version: "v1" }, "a"),
    ).toBe("v1+a");
  });

  it("leaves the version alone when the command ignores the model", () => {
    expect(
      describerVersion({ command: ["x", "{request}"], version: "v1" }, "opus"),
    ).toBe("v1");
  });
});
