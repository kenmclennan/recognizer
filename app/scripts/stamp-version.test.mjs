import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../scripts/temp-dirs.mjs";
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
  "scanners/kotlin/pyproject.toml":
    '[project]\nname = "recognizer-scan-kotlin"\nversion = "0.1.0"\ndependencies = []\n\n[tool.x]\nversion = "1"\n',
  "describers/claude/package.json":
    '{\n  "name": "recognizer-describe-claude",\n  "version": "0.1.0"\n}\n',
  "scanners/rust/Cargo.toml":
    '[package]\nname = "recognizer-scan-rust"\nversion = "0.1.0"\n\n[dependencies]\nserde = { version = "1" }\n',
  "scanners/rust/Cargo.lock":
    '[[package]]\nname = "serde"\nversion = "0.1.0"\n\n[[package]]\nname = "recognizer-scan-rust"\nversion = "0.1.0"\ndependencies = [\n "serde",\n]\n',
};

function fixture() {
  const root = makeTempDir("stamp-");

  mkdirSync(join(root, "app/src-tauri"), { recursive: true });
  mkdirSync(join(root, "check"), { recursive: true });
  mkdirSync(join(root, "scanners/typescript"), { recursive: true });
  mkdirSync(join(root, "scanners/python"), { recursive: true });
  mkdirSync(join(root, "scanners/kotlin"), { recursive: true });
  mkdirSync(join(root, "scanners/rust"), { recursive: true });
  mkdirSync(join(root, "describers/claude"), { recursive: true });

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

  it("changes the eleven versions and no other byte", () => {
    const root = fixture();

    stampVersion(root, "0.3.4");

    for (const [path, text] of Object.entries(FILES)) {
      const stamped =
        path === "scanners/rust/Cargo.lock"
          ? text.replace(
              'name = "recognizer-scan-rust"\nversion = "0.1.0"',
              'name = "recognizer-scan-rust"\nversion = "0.3.4"',
            )
          : text
              .replace('version = "0.1.0"', 'version = "0.3.4"')
              .replace('"version": "0.1.0"', '"version": "0.3.4"');

      expect(readFileSync(join(root, path), "utf8")).toBe(stamped);
    }
  });
});

describe("stampVersion on the real manifests", () => {
  it("leaves every manifest reading the stamped version", () => {
    const repo = fileURLToPath(new URL("../..", import.meta.url));
    const root = makeTempDir("stamp-real-");
    const files = [
      "package.json",
      "check/package.json",
      "scanners/typescript/package.json",
      "app/package.json",
      "app/src-tauri/tauri.conf.json",
      "app/src-tauri/Cargo.toml",
      "scanners/python/pyproject.toml",
      "scanners/kotlin/pyproject.toml",
      "describers/claude/package.json",
      "scanners/rust/Cargo.toml",
      "scanners/rust/Cargo.lock",
    ];

    for (const file of files) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      cpSync(join(repo, file), join(root, file));
    }

    stampVersion(root, "7.8.9");

    const lockBefore = readFileSync(
      join(repo, "scanners/rust/Cargo.lock"),
      "utf8",
    );

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
    expect(
      readFileSync(join(root, "scanners/kotlin/pyproject.toml"), "utf8"),
    ).toMatch(/^version = "7\.8\.9"$/m);
    expect(
      readFileSync(join(root, "scanners/rust/Cargo.toml"), "utf8"),
    ).toMatch(/^version = "7\.8\.9"$/m);

    const lockAfter = readFileSync(
      join(root, "scanners/rust/Cargo.lock"),
      "utf8",
    );

    expect(lockAfter).toContain(
      'name = "recognizer-scan-rust"\nversion = "7.8.9"',
    );
    expect(
      lockAfter.replace(
        'name = "recognizer-scan-rust"\nversion = "7.8.9"',
        'name = "recognizer-scan-rust"\nversion = "0.1.0"',
      ),
    ).toBe(lockBefore);
  });
});
