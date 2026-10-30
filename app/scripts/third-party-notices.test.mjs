import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildNotices, generateAllNotices } from "./third-party-notices.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const NINE = [
  "@tauri-apps/api",
  "ajv",
  "elkjs",
  "fast-deep-equal",
  "fast-uri",
  "json-schema-traverse",
  "require-from-string",
  "typescript",
  "yaml",
];

describe("buildNotices", () => {
  const lock = {
    packages: {
      "": { name: "root" },
      app: { link: false },
      "node_modules/a": { version: "1.0.0", license: "MIT" },
      "node_modules/b": { version: "2.0.0", license: "ISC" },
      "node_modules/dev-only": { version: "3.0.0", dev: true },
      "node_modules/linked": { link: true, resolved: "x" },
    },
  };

  it("writes every production package, with its licence files in name order", () => {
    const text = buildNotices(lock, (path) =>
      path === "node_modules/a"
        ? [
            { name: "NOTICE", text: "second" },
            { name: "LICENSE", text: "first" },
          ]
        : [],
    );

    expect(text).toContain("## a 1.0.0");
    expect(text).toContain("Licence: MIT");
    expect(text.indexOf("first")).toBeLessThan(text.indexOf("second"));
    expect(text).toContain(
      "## b 2.0.0\n\nLicence: ISC\n\nno licence file shipped",
    );
    expect(text).not.toContain("dev-only");
    expect(text).not.toContain("linked");
  });
});

describe("the committed THIRD-PARTY-NOTICES.md", () => {
  const committed = readFileSync(join(ROOT, "THIRD-PARTY-NOTICES.md"), "utf8");

  it("equals the text generated from the real lock, node_modules and Cargo.lock", () => {
    expect(committed).toBe(generateAllNotices(ROOT));
  });

  it("names all nine packages and carries the elkjs EPL-2.0 text", () => {
    for (const name of NINE) {
      expect(committed).toMatch(new RegExp(`^## ${name} \\d`, "m"));
    }

    expect(committed).toContain("Eclipse Public License - v 2.0");
  });

  it("lists the Rust crates with their licences", () => {
    expect(committed).toContain("\n# Rust crates\n");
    expect(committed).toContain("- tauri ");
    expect(committed).toContain("- serde ");
  });
});
