import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../scripts/temp-dirs.mjs";
import { gitListing, listSourceFiles, listTestFiles } from "../src/files.js";
import { scan } from "../src/index.js";
import { TsconfigOptions } from "../src/tsconfig-options.js";
import { discoverWorkspaces } from "../src/workspaces.js";
import { makeTree } from "./helpers.js";

const body = "export const x = 1;\n";

function git(root: string, ...args: string[]): void {
  execFileSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args],
    {
      cwd: root,
      stdio: "pipe",
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      },
    },
  );
}

function put(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

function repository(
  tracked: Record<string, string>,
  extra: Record<string, string> = {},
  ignore = "bin/\n",
): string {
  const root = makeTree({ ...tracked, ".gitignore": ignore });

  git(root, "init", "-q");
  git(root, "add", "-f", ...Object.keys(tracked), ".gitignore");
  git(root, "commit", "-q", "-m", "init");
  put(root, extra);

  return root;
}

function moduleIds(root: string): string[] {
  return scan(root, null).modules.map((module) => module.id);
}

function relative(root: string, paths: string[]): string[] {
  return paths.map((path) => path.slice(root.length + 1)).sort();
}

describe("git listing", () => {
  it("extracts an ignored copy once, from src", () => {
    const root = repository({ "src/a.ts": body }, { "bin/a.ts": body });

    expect(moduleIds(root)).toEqual(["src/a.ts"]);
  });

  it("extracts an untracked file git does not ignore", () => {
    const root = repository({ "src/a.ts": body }, { "src/new.ts": body });

    expect(moduleIds(root)).toEqual(["src/a.ts", "src/new.ts"]);
  });

  it("extracts a tracked file the gitignore also names", () => {
    const root = repository({ "src/a.ts": body, "bin/kept.ts": body });

    expect(moduleIds(root)).toEqual(["bin/kept.ts", "src/a.ts"]);
  });

  it("does not extract a tracked file deleted from disk", () => {
    const root = repository({ "src/a.ts": body, "src/b.ts": body });

    unlinkSync(join(root, "src/b.ts"));

    expect(moduleIds(root)).toEqual(["src/a.ts"]);
  });

  it("extracts every file of a folder that is not a repository", () => {
    const root = makeTree({
      "src/a.ts": body,
      "bin/a.ts": body,
      ".gitignore": "bin/\n",
    });

    expect(moduleIds(root)).toEqual(["bin/a.ts", "src/a.ts"]);
  });

  it("extracts exactly the tracked and untracked-not-ignored files of a mixed tree", () => {
    const root = repository(
      { "src/a.ts": body, "src/b.ts": body },
      { "src/new.ts": body, "bin/c.ts": body },
    );

    unlinkSync(join(root, "src/b.ts"));

    expect(moduleIds(root)).toEqual(["src/a.ts", "src/new.ts"]);
  });

  it("does not extract a nested repository", () => {
    const root = repository({ "src/a.ts": body });
    const inner = join(root, "inner");

    mkdirSync(inner);
    put(inner, { "x.ts": body });
    git(inner, "init", "-q");
    git(inner, "add", "x.ts");
    git(inner, "commit", "-q", "-m", "init");

    expect(moduleIds(root)).toEqual(["src/a.ts"]);
  });

  it("scans a subfolder root with ids relative to it", () => {
    const root = repository(
      { "sub/src/a.ts": body },
      { "sub/bin/a.ts": body },
      "sub/bin/\n",
    );

    expect(moduleIds(join(root, "sub"))).toEqual(["src/a.ts"]);
  });

  it("filters test files through the listing", () => {
    const root = repository(
      { "src/a.ts": body, "tests/a.test.ts": body },
      { "bin/b.test.ts": body },
    );

    expect(relative(root, listTestFiles(root))).toEqual(["tests/a.test.ts"]);
    expect(relative(root, listSourceFiles(root))).toEqual(["src/a.ts"]);
  });

  it("filters workspace package directories through the listing", () => {
    const root = repository(
      {
        "package.json": '{"workspaces":["packages/*","bin/*"]}',
        "packages/one/package.json": '{"name":"one"}',
      },
      { "bin/two/package.json": '{"name":"two"}' },
    );

    expect([...discoverWorkspaces(root).keys()]).toEqual(["one"]);
  });

  it("filters tsconfig project directories through the listing", () => {
    const root = repository(
      { "src/a.ts": body },
      { "bin/bad/tsconfig.json": "{ not json" },
    );

    expect(new TsconfigOptions(root).skippedProjects()).toEqual([]);
  });

  it("reads no manifest or page from an ignored folder", () => {
    const root = repository(
      { "src/a.ts": body, "package.json": '{"main":"src/a.ts"}' },
      {
        "bin/package.json": '{"main":"a.ts"}',
        "bin/index.html": '<script src="a.ts"></script>',
      },
    );
    const paths = scan(root, null).files.map((file) => file.path);

    expect(paths.filter((path) => path.startsWith("bin/"))).toEqual([]);
    expect(paths).toContain("package.json");
  });

  it("lists every file without a warning when git is not on the path", () => {
    const root = repository({ "src/a.ts": body }, { "bin/a.ts": body });
    const empty = makeTempDir("recognizer-ts-nogit-");
    const path = process.env.PATH;

    process.env.PATH = empty;

    try {
      const writes: string[] = [];
      const write = process.stderr.write.bind(process.stderr);

      process.stderr.write = ((text: string) => {
        writes.push(text);
        return true;
      }) as typeof process.stderr.write;

      try {
        expect(gitListing(root)).toBeNull();
        expect(relative(root, listSourceFiles(root, null))).toEqual([
          "bin/a.ts",
          "src/a.ts",
        ]);
      } finally {
        process.stderr.write = write;
      }

      expect(writes).toEqual([]);
    } finally {
      process.env.PATH = path;
    }
  });

  it("warns once and lists every file when git refuses for another reason", () => {
    const root = repository({ "src/a.ts": body }, { "bin/a.ts": body });
    const wrapper = makeTempDir("recognizer-ts-wrapper-");
    const script = join(wrapper, "git");

    writeFileSync(
      script,
      "#!/bin/sh\necho 'fatal: detected dubious ownership in repository' >&2\nexit 128\n",
    );
    chmodSync(script, 0o755);

    const result = spawnSync(
      process.execPath,
      [
        "-e",
        `const { gitListing } = await import(${JSON.stringify(join(import.meta.dirname, "../dist/files.js"))});
         process.stdout.write(String(gitListing(${JSON.stringify(root)})));`,
        "--input-type=module",
      ],
      { encoding: "utf8", env: { ...process.env, PATH: wrapper } },
    );

    expect(result.stdout).toBe("null");
    expect(result.stderr).toBe(
      "recognizer-scan-typescript: git could not list files (fatal: detected dubious ownership in repository); scanning every file\n",
    );
    rmSync(wrapper, { recursive: true, force: true });
  });
});
