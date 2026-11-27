import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  DETECTION_LISTING,
  type RepositoryFiles,
  type RepositoryListing,
  SETUP_LISTING,
  SOURCE_LISTING,
} from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../../tools/scripts/temp-dirs.mjs";
import { RepositoryFilesAdapter } from "../../src/adapters/filesystem/repository-files-adapter.js";
import { nodeIo } from "../../src/cli.js";
import { FakeRepositoryFiles, FakeSetupFiles } from "../support/index.js";

interface World {
  files: RepositoryFiles;
  root: string;
}

interface Builder {
  repository(): World;
  outside(files: string[]): World;
  presence(
    listed: string[],
    present: string[],
  ): { files: RepositoryFiles; root: string };
}

const UNTRACKED = ["new.ts", "ignored.txt", ".recognizer/p", "a/.recognizer/q"];

function pathsOf(listing: RepositoryListing): string[] {
  if (listing.from === "none") {
    throw new Error("expected a listing");
  }

  return listing.paths;
}

function write(root: string, path: string, text = ""): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

function git(root: string, args: string[]): void {
  execFileSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args],
    { cwd: root, stdio: "ignore" },
  );
}

function fakeOver(
  listed: string[] | null,
  present: string[],
  gitless: boolean,
): World {
  const setup = new FakeSetupFiles();
  const files = new FakeRepositoryFiles(setup);

  for (const path of present) {
    setup.seed(`/repo/${path}`, "");
  }

  files.listed = listed;
  files.gitless = gitless;

  return { files, root: "/repo" };
}

const fake: Builder = {
  repository: () =>
    fakeOver(
      [
        ".gitignore",
        "a/f.ts",
        "gone.ts",
        "new.ts",
        ".recognizer/p",
        "a/.recognizer/q",
      ],
      [
        ".gitignore",
        "a/f.ts",
        "new.ts",
        "ignored.txt",
        ".recognizer/p",
        "a/.recognizer/q",
      ],
      false,
    ),
  outside: (files) => fakeOver(null, files, true),
  presence: (listed, present) => fakeOver(listed, present, false),
};

const real: Builder = {
  repository() {
    const root = makeTempDir("repository-files-contract-");

    write(root, ".gitignore", "ignored.txt\n");
    write(root, "a/f.ts");
    write(root, "gone.ts");
    git(root, ["init", "-q"]);
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "init"]);
    rmSync(join(root, "gone.ts"));

    for (const path of UNTRACKED) {
      write(root, path);
    }

    return { files: new RepositoryFilesAdapter(nodeIo()), root };
  },
  outside(files) {
    const root = makeTempDir("repository-files-outside-");

    for (const path of files) {
      write(root, path);
    }

    return { files: new RepositoryFilesAdapter(nodeIo()), root };
  },
  presence(listed, present) {
    const root = makeTempDir("repository-files-presence-");

    for (const path of listed) {
      write(root, path);
    }

    git(root, ["init", "-q"]);
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "init"]);

    for (const path of listed.filter((one) => !present.includes(one))) {
      rmSync(join(root, path));
    }

    return { files: new RepositoryFilesAdapter(nodeIo()), root };
  },
};

function suite(title: string, make: Builder): void {
  describe(title, () => {
    it("the source listing keeps a tracked deleted file and a nested own-state folder, and drops the ignored file and the top-level own state", () => {
      const { files, root } = make.repository();
      const paths = pathsOf(files.list(root, SOURCE_LISTING));

      expect(paths).toContain("gone.ts");
      expect(paths).toContain("new.ts");
      expect(paths).toContain("a/.recognizer/q");
      expect(paths).not.toContain("ignored.txt");
      expect(paths).not.toContain(".recognizer/p");
    });

    it("the setup listing omits the deleted file and keeps the top-level own state", () => {
      const { files, root } = make.repository();
      const paths = pathsOf(files.list(root, SETUP_LISTING));

      expect(paths).toContain("new.ts");
      expect(paths).toContain(".recognizer/p");
      expect(paths).not.toContain("gone.ts");
      expect(paths).not.toContain("ignored.txt");
    });

    it("the detection listing keeps the deleted file and the top-level own state", () => {
      const { files, root } = make.repository();
      const paths = pathsOf(files.list(root, DETECTION_LISTING));

      expect(paths).toContain("gone.ts");
      expect(paths).toContain(".recognizer/p");
    });

    it("outside git the detection listing is none without a warning", () => {
      const { files, root } = make.outside(["a.txt"]);

      expect(files.list(root, DETECTION_LISTING)).toEqual({
        from: "none",
        warning: null,
      });
    });

    it.each([
      ["source", SOURCE_LISTING],
      ["setup", SETUP_LISTING],
    ])(
      "outside git the %s listing walks the files and skips the skipped folders",
      (_name, request) => {
        const { files, root } = make.outside([
          "a.txt",
          ".git/h",
          "dist/d",
          "build/b",
          ".worktrees/w",
          ".recognizer/r",
          "target/x.rs",
          "node_modules/y.ts",
        ]);
        const listing = files.list(root, request);

        expect(listing.from).toBe("walk");

        const paths = pathsOf(listing);

        expect(paths.length).toBeGreaterThan(0);
        expect(paths).toEqual(["a.txt", "node_modules/y.ts", "target/x.rs"]);
      },
    );

    it.each([
      ["some present", ["a.ts", "b.ts", "c.ts"], ["a.ts", "c.ts"]],
      ["all present", ["a.ts", "b.ts"], ["a.ts", "b.ts"]],
      ["none present", ["a.ts", "b.ts"], []],
    ])(
      "the setup listing returns exactly the listed paths that are present: %s",
      (_name, listed, present) => {
        const { files, root } = make.presence(listed, present);

        expect([...pathsOf(files.list(root, SETUP_LISTING))].sort()).toEqual(
          present,
        );
      },
    );
  });
}

suite("RepositoryFiles contract (fake)", fake);

suite("RepositoryFiles contract (real adapter)", real);
