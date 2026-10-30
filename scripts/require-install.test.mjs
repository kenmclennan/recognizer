import { mkdirSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installProblem } from "./require-install.mjs";
import { makeTempDir } from "./temp-dirs.mjs";

function repository({
  installed = true,
  linked = true,
  installedAt = 2000,
} = {}) {
  const root = makeTempDir("require-install-");

  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ workspaces: ["pkg"] }),
  );
  writeFileSync(join(root, "package-lock.json"), "{}");
  utimesSync(join(root, "package-lock.json"), 1000, 1000);
  mkdirSync(join(root, "pkg"));
  writeFileSync(
    join(root, "pkg", "package.json"),
    JSON.stringify({ name: "pkg-name" }),
  );

  if (installed) {
    mkdirSync(join(root, "node_modules"));
    writeFileSync(join(root, "node_modules", ".package-lock.json"), "{}");
    utimesSync(
      join(root, "node_modules", ".package-lock.json"),
      installedAt,
      installedAt,
    );

    if (linked) {
      symlinkSync(join(root, "pkg"), join(root, "node_modules", "pkg-name"));
    }
  }

  return root;
}

describe("installProblem", () => {
  it("accepts a fresh install", () => {
    expect(installProblem(repository())).toBeNull();
  });

  it("names npm ci when node_modules is missing", () => {
    expect(installProblem(repository({ installed: false }))).toMatch(
      /missing.*run npm ci at the repository root/,
    );
  });

  it("names npm ci when node_modules is older than package-lock.json", () => {
    expect(installProblem(repository({ installedAt: 500 }))).toMatch(
      /older.*run npm ci at the repository root/,
    );
  });

  it("names npm ci when a workspace is not installed", () => {
    expect(installProblem(repository({ linked: false }))).toMatch(
      /pkg-name.*run npm ci at the repository root/,
    );
  });
});
