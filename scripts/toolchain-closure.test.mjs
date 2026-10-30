import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { closureFromLock, verifyVendored } from "./toolchain-closure.mjs";

const lock = {
  packages: {
    "": {},
    app: { dependencies: { a: "^1" } },
    "node_modules/app": { link: true, resolved: "app" },
    "node_modules/a": { version: "1.0.0", dependencies: { b: "^2", app: "*" } },
    "node_modules/b": { version: "2.0.0" },
    "node_modules/a/node_modules/b": { version: "2.1.0" },
    "node_modules/dev-only": { version: "9.0.0", dev: true },
    "node_modules/c": { version: "3.0.0" },
  },
};

describe("closureFromLock", () => {
  it("returns production dependencies only and prefers the nested version", () => {
    const closure = closureFromLock(lock, ["app"]);

    expect([...closure]).toEqual([
      ["node_modules/a", "1.0.0"],
      ["node_modules/a/node_modules/b", "2.1.0"],
    ]);
    expect(closure.has("node_modules/dev-only")).toBe(false);
  });

  it("does not follow a workspace link", () => {
    expect(closureFromLock(lock, ["app"]).has("node_modules/app")).toBe(false);
  });

  it("throws naming a dependency that resolves to nothing", () => {
    const broken = { packages: { app: { dependencies: { ghost: "^1" } } } };

    expect(() => closureFromLock(broken, ["app"])).toThrow(/ghost/);
  });

  it("returns exactly today's seven packages for the real lockfile", () => {
    const real = JSON.parse(
      readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"),
    );

    expect([...closureFromLock(real)]).toEqual([
      ["node_modules/ajv", "8.20.0"],
      ["node_modules/fast-deep-equal", "3.1.3"],
      ["node_modules/fast-uri", "3.1.8"],
      ["node_modules/json-schema-traverse", "1.0.0"],
      ["node_modules/require-from-string", "2.0.2"],
      ["node_modules/typescript", "5.9.3"],
      ["node_modules/yaml", "2.9.1"],
    ]);
  });
});

describe("verifyVendored", () => {
  const small = {
    packages: {
      app: { dependencies: { good: "1", wrong: "1", gone: "1" } },
      "node_modules/good": { version: "1.0.0" },
      "node_modules/wrong": { version: "1.0.0" },
      "node_modules/gone": { version: "1.0.0" },
    },
  };

  it("names every bad package and not the good one", () => {
    const found = {
      "node_modules/good": "1.0.0",
      "node_modules/wrong": "1.0.1",
      "node_modules/gone": undefined,
      "node_modules/extra": "1.0.0",
    };

    expect(() => verifyVendored(small, found, ["app"])).toThrow(
      /wrong[\s\S]*gone[\s\S]*extra|gone[\s\S]*wrong[\s\S]*extra/,
    );

    try {
      verifyVendored(small, found, ["app"]);
    } catch (error) {
      expect(error.message).not.toMatch(/node_modules\/good/);
    }
  });

  it("returns when everything matches", () => {
    const found = {
      "node_modules/good": "1.0.0",
      "node_modules/wrong": "1.0.0",
      "node_modules/gone": "1.0.0",
    };

    expect(() => verifyVendored(small, found, ["app"])).not.toThrow();
  });
});
