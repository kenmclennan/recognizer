import {
  DETECTION_LISTING,
  SETUP_LISTING,
  SOURCE_LISTING,
} from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { RepositoryFilesAdapter } from "../../src/adapters/filesystem/repository-files-adapter.js";
import { fakeIo, ROOT } from "../scan-helpers.js";

describe("RepositoryFilesAdapter", () => {
  it("walks into target and node_modules, and not into .git", () => {
    const fake = fakeIo({
      files: {
        [`${ROOT}/a.rs`]: "",
        [`${ROOT}/target/x.rs`]: "",
        [`${ROOT}/node_modules/y.ts`]: "",
        [`${ROOT}/.git/z.ts`]: "",
      },
    });
    const listing = new RepositoryFilesAdapter(fake.io).list(
      ROOT,
      SETUP_LISTING,
    );

    expect(listing.from).toBe("walk");

    const paths = listing.from === "none" ? [] : listing.paths;

    expect(paths).toContain("a.rs");
    expect(paths).toContain("target/x.rs");
    expect(paths).toContain("node_modules/y.ts");
    expect(paths).not.toContain(".git/z.ts");
  });

  it("walks in name order", () => {
    const fake = fakeIo({
      files: {
        [`${ROOT}/b.rs`]: "",
        [`${ROOT}/a/z.rs`]: "",
        [`${ROOT}/a/y.rs`]: "",
        [`${ROOT}/c.rs`]: "",
      },
    });
    const listing = new RepositoryFilesAdapter(fake.io).list(
      ROOT,
      SETUP_LISTING,
    );
    const paths = listing.from === "none" ? [] : listing.paths;

    expect(paths.filter((path) => path.endsWith(".rs"))).toEqual([
      "a/y.rs",
      "a/z.rs",
      "b.rs",
      "c.rs",
    ]);
  });

  it("reports the first line of what git refused with as a warning", () => {
    const fake = fakeIo({
      listing: {
        status: 128,
        stderr: "fatal: detected dubious ownership in repository\nmore\n",
      },
    });

    expect(
      new RepositoryFilesAdapter(fake.io).list(ROOT, DETECTION_LISTING),
    ).toEqual({
      from: "none",
      warning: "fatal: detected dubious ownership in repository",
    });
  });

  it("reports exit status when git refuses without a message", () => {
    const fake = fakeIo({ listing: { status: 3 } });

    expect(
      new RepositoryFilesAdapter(fake.io).list(ROOT, DETECTION_LISTING),
    ).toEqual({ from: "none", warning: "exit 3" });
  });

  it("gives no warning when git did not start", () => {
    const fake = fakeIo({ listing: { started: false } });

    expect(
      new RepositoryFilesAdapter(fake.io).list(ROOT, DETECTION_LISTING),
    ).toEqual({ from: "none", warning: null });
  });

  it("gives no warning outside a repository for detection, and walks for the others", () => {
    const fake = fakeIo({
      files: { [`${ROOT}/a.rs`]: "" },
      listing: { status: 128, stderr: "fatal: not a git repository" },
    });
    const adapter = new RepositoryFilesAdapter(fake.io);

    expect(adapter.list(ROOT, DETECTION_LISTING)).toEqual({
      from: "none",
      warning: null,
    });
    expect(adapter.list(ROOT, SOURCE_LISTING).from).toBe("walk");
    expect(adapter.list(ROOT, SETUP_LISTING).from).toBe("walk");
  });

  it("gives none without a warning when the root cannot be read", () => {
    const fake = fakeIo({ listing: { status: 128 } });
    const missing = "/does/not/exist";

    expect(
      new RepositoryFilesAdapter(fake.io).list(missing, SOURCE_LISTING),
    ).toEqual({ from: "none", warning: null });
  });
});
