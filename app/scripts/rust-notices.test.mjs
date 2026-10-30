import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildRustNotices,
  cargoMetadata,
  licenceAccepted,
  readCrateLicenseFiles,
  unacceptedCrates,
} from "./rust-notices.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

describe("licenceAccepted", () => {
  it.each([
    "MIT",
    "MIT OR Apache-2.0",
    "Apache-2.0 / MIT",
    "Unlicense OR MIT",
    "(MIT OR Apache-2.0) AND Unicode-3.0",
    "Apache-2.0 WITH LLVM-exception",
    "BSD-3-Clause AND MIT",
    "CC0-1.0 OR MIT-0 OR Apache-2.0",
  ])("accepts %s", (expression) => {
    expect(licenceAccepted(expression)).toBe(true);
  });

  it.each([
    "GPL-3.0-only",
    "MIT AND GPL-3.0-only",
    "LGPL-2.1 OR GPL-3.0-only",
    "Apache-2.0 WITH Classpath-exception-2.0",
    "",
    undefined,
  ])("rejects %s", (expression) => {
    expect(licenceAccepted(expression)).toBe(false);
  });
});

describe("buildRustNotices", () => {
  const crate = (name, license) => ({ name, version: "1.0.0", license });

  it("fails naming the crate whose licence is outside the list", () => {
    expect(() =>
      buildRustNotices(
        [crate("fine", "MIT"), crate("copyleft", "GPL-3.0-only")],
        () => [],
      ),
    ).toThrow(/copyleft 1\.0\.0 \(GPL-3\.0-only\)/);
  });

  it("shares one entry between crates with identical licence files", () => {
    const text = buildRustNotices(
      [crate("a", "MIT"), crate("b", "MIT"), crate("c", "ISC")],
      (c) => [{ name: "LICENSE", text: c.license === "MIT" ? "mit" : "isc" }],
    );

    expect(text).toContain("- a 1.0.0 (MIT)\n- b 1.0.0 (MIT)\n\n### LICENSE");
    expect(text.match(/```text\nmit\n```/g)).toHaveLength(1);
    expect(text).toContain("- c 1.0.0 (ISC)");
  });

  it("says so when a crate ships no licence file", () => {
    expect(buildRustNotices([crate("bare", "MIT")], () => [])).toContain(
      "- bare 1.0.0 (MIT)\n\nno licence file shipped",
    );
  });
});

describe("the app's real dependency closure", () => {
  const crates = cargoMetadata(ROOT);

  it("is inside the accepted licences", () => {
    expect(unacceptedCrates(crates)).toEqual([]);
  });

  it("includes tauri and ships its licence text", () => {
    const tauri = crates.find((c) => c.name === "tauri");

    expect(tauri).toBeDefined();
    expect(readCrateLicenseFiles(tauri).length).toBeGreaterThan(0);
  });
});
