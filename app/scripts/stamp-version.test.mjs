import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stampVersion } from "./stamp-version.mjs";

const FILES = {
  "app/src-tauri/tauri.conf.json":
    '{\n  "productName": "Recognizer",\n  "version": "0.1.0",\n  "identifier": "x"\n}\n',
  "app/src-tauri/Cargo.toml":
    '[package]\nname = "recognizer_app"\nversion = "0.1.0"\n\n[dependencies]\nserde = { version = "1" }\n',
  "app/package.json":
    '{\n  "name": "@recognizer/app",\n  "version": "0.1.0",\n  "dependencies": { "a": "^0.1.0" }\n}\n',
};

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "stamp-"));

  mkdirSync(join(root, "app/src-tauri"), { recursive: true });

  for (const [path, text] of Object.entries(FILES)) {
    writeFileSync(join(root, path), text);
  }

  return root;
}

describe("stampVersion", () => {
  it("throws when a file has no version", () => {
    const root = fixture();

    writeFileSync(join(root, "app/package.json"), '{\n  "name": "x"\n}\n');

    expect(() => stampVersion(root, "0.3.4")).toThrow(
      /No version found in .*app\/package\.json/,
    );
  });

  it("changes the three versions and no other byte", () => {
    const root = fixture();

    stampVersion(root, "0.3.4");

    for (const [path, text] of Object.entries(FILES)) {
      expect(readFileSync(join(root, path), "utf8")).toBe(
        text
          .replace('version = "0.1.0"', 'version = "0.3.4"')
          .replace('"version": "0.1.0"', '"version": "0.3.4"'),
      );
    }
  });
});
