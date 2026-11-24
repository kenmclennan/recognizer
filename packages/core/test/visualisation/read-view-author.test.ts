import { describe, expect, it } from "vitest";
import { readViewAuthor } from "../../src/index.js";
import { FakeGit } from "../fakes/fake-git.js";

describe("readViewAuthor", () => {
  it("trims the name, cuts it at 64 characters and falls back to Me", () => {
    const git = new FakeGit("c0ffee");

    git.user = "  Ada Lovelace \n";
    expect(readViewAuthor({ git }, "/r")).toBe("Ada Lovelace");

    git.user = "x".repeat(80);
    expect(readViewAuthor({ git }, "/r")).toBe("x".repeat(64));

    git.user = "   \n";
    expect(readViewAuthor({ git }, "/r")).toBe("Me");

    git.user = null;
    expect(readViewAuthor({ git }, "/r")).toBe("Me");
  });
});
