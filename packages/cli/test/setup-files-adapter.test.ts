import { describe, expect, it } from "vitest";
import { SetupFilesAdapter } from "../src/adapters/filesystem/setup-files-adapter.js";
import { fakeIo, ROOT } from "./scan-helpers.js";

describe("SetupFilesAdapter", () => {
  it("walks into target and node_modules, and not into .git", () => {
    const fake = fakeIo({
      files: {
        [`${ROOT}/a.rs`]: "",
        [`${ROOT}/target/x.rs`]: "",
        [`${ROOT}/node_modules/y.ts`]: "",
        [`${ROOT}/.git/z.ts`]: "",
      },
    });
    const listed = new SetupFilesAdapter(fake.io).list(ROOT);

    expect(listed).toContain("a.rs");
    expect(listed).toContain("target/x.rs");
    expect(listed).toContain("node_modules/y.ts");
    expect(listed).not.toContain(".git/z.ts");
  });
});
