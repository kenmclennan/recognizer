import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkLink, isLink, parseLink } from "../src/link.js";
import { fakeIo } from "./scan-helpers.js";

type Case =
  | { link: string; ok: true; repo: string; view: string | null }
  | { link: string; ok: false };

const table: Case[] = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "fixtures",
      "links",
      "syntax.json",
    ),
    "utf8",
  ),
);

describe("parseLink against the shared syntax table", () => {
  it("reads the table", () => {
    expect(table.length).toBeGreaterThan(30);
  });

  it.each(table.map((entry) => [entry.link, entry] as const))(
    "%s",
    (_link, entry) => {
      const parsed = parseLink(entry.link);

      if (entry.ok) {
        expect(parsed).toEqual({
          ok: true,
          link: { repo: entry.repo, view: entry.view },
        });
      } else {
        expect(parsed.ok).toBe(false);
      }
    },
  );
});

describe("isLink", () => {
  it("matches the scheme in any case only", () => {
    expect(isLink("recognizer://open")).toBe(true);
    expect(isLink("Recognizer://x")).toBe(true);
    expect(isLink("recognizer-x")).toBe(false);
    expect(isLink("/tmp/recognizer://")).toBe(false);
  });
});

describe("checkLink", () => {
  const repo = "/work/app";
  const io = fakeIo({
    files: { [`${repo}/.recognizer/views/overview.json`]: "{}" },
  }).io;

  it("accepts a folder with the saved view", () => {
    expect(checkLink({ repo, view: "overview" }, io)).toBeNull();
  });

  it("accepts a link with no view for an existing folder", () => {
    expect(checkLink({ repo, view: null }, io)).toBeNull();
  });

  it("refuses a missing folder", () => {
    expect(checkLink({ repo: "/nowhere", view: null }, io)).toContain(
      "/nowhere",
    );
  });

  it("refuses a view that is not saved there, naming it, while the saved one passes", () => {
    expect(checkLink({ repo, view: "overview" }, io)).toBeNull();
    expect(checkLink({ repo, view: "other" }, io)).toContain(
      "other is not a saved view",
    );
  });
});
