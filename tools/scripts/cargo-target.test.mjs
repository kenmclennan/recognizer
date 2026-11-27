import { spawnSync } from "node:child_process";
import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cargoTargetDir,
  DEFAULT_FOLDER_NAME,
  mainCheckout,
  withCargoTarget,
} from "./cargo-target.mjs";
import { makeTempDir } from "./temp-dirs.mjs";

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });

  expect(result.status, result.stderr).toBe(0);
}

function makeCheckoutWithWorktree() {
  const parent = makeTempDir("recognizer-cargo-target-");
  const main = join(parent, "main");

  mkdirSync(main);
  git(main, "init", "-q", "-b", "main");
  git(
    main,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "x",
  );
  git(main, "worktree", "add", "-q", join(main, ".worktrees", "w"), "-b", "w");

  return { parent, main, worktree: join(main, ".worktrees", "w") };
}

describe("cargo target folder", () => {
  it("uses CARGO_TARGET_DIR when it is set", () => {
    expect(cargoTargetDir("/repo", { CARGO_TARGET_DIR: "/shared/t" })).toBe(
      "/shared/t",
    );
  });

  it("resolves a relative CARGO_TARGET_DIR against the root", () => {
    expect(cargoTargetDir("/repo", { CARGO_TARGET_DIR: "t" })).toBe("/repo/t");
  });

  it("defaults a worktree and its main checkout to the same folder beside the main checkout", () => {
    const { parent, main, worktree } = makeCheckoutWithWorktree();

    expect(mainCheckout(worktree)).toBe(mainCheckout(main));
    expect(cargoTargetDir(worktree, {})).toBe(cargoTargetDir(main, {}));
    expect(cargoTargetDir(worktree, {})).toBe(
      join(realpathSync(parent), DEFAULT_FOLDER_NAME),
    );
  });

  it("puts the resolved folder into the environment it returns", () => {
    expect(
      withCargoTarget("/repo", { CARGO_TARGET_DIR: "/x", A: "1" }),
    ).toEqual({
      CARGO_TARGET_DIR: "/x",
      A: "1",
    });
  });
});
