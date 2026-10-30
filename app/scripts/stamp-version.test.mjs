import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stampVersion } from "./stamp-version.mjs";

const FILES = {
  "app/src-tauri/tauri.conf.json":
    '{\n  "productName": "Recognizer",\n  "version": "0.1.0",\n  "identifier": "x"\n}\n',
  "app/src-tauri/Cargo.toml":
    '[package]\nname = "recognizer_app"\nversion = "0.1.0"\n\n[dependencies]\nserde = { version = "1" }\n',
  "app/package.json":
    '{\n  "name": "@recognizer/app",\n  "version": "0.1.0",\n  "dependencies": { "a": "^0.1.0" }\n}\n',
  "package.json": '{\n  "version": "0.1.0",\n  "private": true\n}\n',
  "check/package.json":
    '{\n  "name": "recognizer",\n  "version": "0.1.0",\n  "dependencies": { "a": "^0.1.0" }\n}\n',
  "scanners/typescript/package.json":
    '{\n  "name": "recognizer-scan-typescript",\n  "version": "0.1.0"\n}\n',
  "scanners/python/pyproject.toml":
    '[project]\nname = "recognizer-scan-python"\nversion = "0.1.0"\ndependencies = []\n\n[tool.x]\nversion = "1"\n',
};

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "stamp-"));

  mkdirSync(join(root, "app/src-tauri"), { recursive: true });
  mkdirSync(join(root, "check"), { recursive: true });
  mkdirSync(join(root, "scanners/typescript"), { recursive: true });
  mkdirSync(join(root, "scanners/python"), { recursive: true });

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

  it("changes the seven versions and no other byte", () => {
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

describe("stampVersion on the real manifests", () => {
  it("leaves every manifest reading the stamped version", () => {
    const repo = fileURLToPath(new URL("../..", import.meta.url));
    const root = mkdtempSync(join(tmpdir(), "stamp-real-"));
    const files = [
      "package.json",
      "check/package.json",
      "scanners/typescript/package.json",
      "app/package.json",
      "app/src-tauri/tauri.conf.json",
      "app/src-tauri/Cargo.toml",
      "scanners/python/pyproject.toml",
    ];

    for (const file of files) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      cpSync(join(repo, file), join(root, file));
    }

    stampVersion(root, "7.8.9");

    for (const file of files.filter((name) => name.endsWith(".json"))) {
      expect(JSON.parse(readFileSync(join(root, file), "utf8")).version).toBe(
        "7.8.9",
      );
    }

    expect(
      readFileSync(join(root, "scanners/python/pyproject.toml"), "utf8"),
    ).toMatch(/^version = "7\.8\.9"$/m);
    expect(
      readFileSync(join(root, "app/src-tauri/Cargo.toml"), "utf8"),
    ).toMatch(/^version = "7\.8\.9"$/m);
  });
});
