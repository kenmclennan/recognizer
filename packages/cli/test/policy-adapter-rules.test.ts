import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PolicyAdapter } from "../src/adapters/filesystem/policy-adapter.js";
import { parsePolicy } from "../src/adapters/filesystem/policy-translator.js";
import { policyFile } from "../src/config.js";
import { InputError } from "../src/errors.js";
import { FakeIo } from "./support/index.js";

const ROOT = "/repo";
const REPO = join(__dirname, "../../..");

const VALID = "forbid:\n  - a/** -> b/**\n";

describe("PolicyAdapter.rules", () => {
  it("is null when there is no policy file", () => {
    expect(new PolicyAdapter(new FakeIo()).rules(ROOT)).toBeNull();
  });

  it("parses a present policy file", () => {
    const io = new FakeIo();

    io.writeFile(policyFile(ROOT), VALID);

    expect(new PolicyAdapter(io).rules(ROOT)).toEqual(parsePolicy(VALID));
  });

  it("throws the parse error for an invalid policy file", () => {
    const io = new FakeIo();

    io.writeFile(policyFile(ROOT), "forbid: 3\n");

    expect(() => new PolicyAdapter(io).rules(ROOT)).toThrow(InputError);
  });

  it("reads the committed fixture policy", () => {
    const text = readFileSync(
      join(REPO, "fixtures/check/.recognizer/policy.yaml"),
      "utf8",
    );
    const io = new FakeIo();

    io.writeFile(policyFile(ROOT), text);

    const rules = new PolicyAdapter(io).rules(ROOT) ?? [];

    expect(rules).toEqual(parsePolicy(text));
    expect(rules).toHaveLength(8);
    expect(rules.filter((rule) => rule.type === "forbid")).toHaveLength(6);
  });
});
