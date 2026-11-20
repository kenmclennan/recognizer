import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../scripts/temp-dirs.mjs";
import { nodeIo } from "../src/cli.js";
import type { Scan } from "../src/scan.js";
import {
  type PolicyCard,
  parseCard,
  policyCommands,
  recommend,
} from "../src/setup-recommend.js";
import { REPO } from "./helpers.js";

const scan = JSON.parse(
  readFileSync(join(REPO, "fixtures/setup-loom/scan.json"), "utf8"),
) as Scan;

function repository(policy: string | null): string {
  const root = makeTempDir("recognizer-setup-recommend-");

  mkdirSync(join(root, ".recognizer"), { recursive: true });

  if (policy !== null) {
    writeFileSync(join(root, ".recognizer/policy.yaml"), policy);
  }

  return root;
}

const forbid = (
  from: string[],
  to: string[],
  both = false,
): Record<string, unknown> => ({
  kind: "forbid",
  from,
  to,
  both,
  why: "w",
  based_on: "b",
});

describe("setup recommend", () => {
  it("each accepted kind maps to exactly its commands", () => {
    const cards = [
      { kind: "ignore", globs: ["a/*", "b/*"], why: "w", based_on: "b" },
      { kind: "entry", paths: ["src/main.ts"], why: "w", based_on: "b" },
      forbid(["ui/**"], ["db/**", "net/**"]),
      forbid(["ui/**"], ["db/**"], true),
    ].map((card) => parseCard(card) as PolicyCard);

    expect(cards.every((card) => card !== null)).toBe(true);
    expect(policyCommands(cards[0] as PolicyCard)).toEqual([
      ["recognizer", "policy", "--add", "ignore", "a/*"],
      ["recognizer", "policy", "--add", "ignore", "b/*"],
    ]);
    expect(policyCommands(cards[1] as PolicyCard)).toEqual([
      ["recognizer", "policy", "--add", "entry", "src/main.ts"],
    ]);
    expect(policyCommands(cards[2] as PolicyCard)).toEqual([
      [
        "recognizer",
        "policy",
        "--add-forbid",
        "--from",
        "ui/**",
        "--to",
        "db/**",
        "--to",
        "net/**",
      ],
    ]);
    expect(policyCommands(cards[3] as PolicyCard)).toEqual([
      [
        "recognizer",
        "policy",
        "--add-forbid",
        "--from",
        "ui/**",
        "--to",
        "db/**",
      ],
      [
        "recognizer",
        "policy",
        "--add-forbid",
        "--from",
        "db/**",
        "--to",
        "ui/**",
      ],
    ]);
  });

  it("drops a card already in the policy and one the policy parser refuses, naming each", () => {
    const root = repository("ignore:\n  - scripts/*\n");
    const answer = recommend(
      nodeIo(),
      root,
      {
        entries: [
          { kind: "ignore", globs: ["scripts/*"], why: "w", based_on: "b" },
          { kind: "entry", paths: ["   "], why: "w", based_on: "b" },
          {
            kind: "entry",
            paths: ["app/src/main.ts"],
            why: "w",
            based_on: "b",
          },
        ],
      },
      [scan],
    );

    expect(answer.entries).toHaveLength(1);
    expect(answer.dropped.map((one) => one.reason)).toEqual([
      "already in the policy",
      expect.stringMatching(/non-empty string/),
    ]);
    expect(answer.dropped.map((one) => one.summary)).toEqual([
      "ignore scripts/*",
      "entry    ",
    ]);
  });

  it("shows a count, a zero and a named drop for three forbid cards", () => {
    const root = repository(null);
    const answer = recommend(
      nodeIo(),
      root,
      {
        entries: [
          forbid(["app/**"], ["engine/**"]),
          forbid(["engine/**"], ["app/**"]),
          forbid([" "], ["app/**"]),
        ],
      },
      [scan],
    );
    const today = answer.entries.map((card) =>
      card.kind === "forbid" ? card.today : undefined,
    );

    expect(today).toEqual([
      { count: 1, example: "app/src/main.ts -> engine/src/index.ts" },
      { count: 0, example: null },
    ]);
    expect(answer.dropped).toHaveLength(1);
    expect(answer.dropped[0]?.kind).toBe("forbid");
  });

  it("counts both directions of a mutual rule and ignores what the policy ignores", () => {
    const both = recommend(
      nodeIo(),
      repository(null),
      { entries: [forbid(["app/**"], ["engine/**"], true)] },
      [scan],
    );
    const ignoring = recommend(
      nodeIo(),
      repository("ignore:\n  - engine/src/index.ts\n"),
      { entries: [forbid(["app/**"], ["engine/**"])] },
      [scan],
    );

    expect(both.entries[0]).toMatchObject({ today: { count: 1 } });
    expect(ignoring.entries[0]).toMatchObject({ today: { count: 0 } });
  });

  it("refuses an input that is not a recommendation", () => {
    expect(() =>
      recommend(nodeIo(), repository(null), { entries: [{ kind: "x" }] }, []),
    ).toThrow(/wrong shape/);
    expect(() => recommend(nodeIo(), repository(null), [], [])).toThrow(
      /no entries/,
    );
  });
});
