import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO, runBin, validate } from "./helpers.js";

describe("scanning check/", () => {
  const check = join(REPO, "check");

  it("describes the project's own source", () => {
    const result = runBin(check);
    expect(result.status).toBe(0);

    const doc = JSON.parse(result.stdout);
    validate(doc);

    const sources = (
      readdirSync(join(check, "src"), { recursive: true }) as string[]
    ).filter((name) => name.endsWith(".ts"));

    expect(doc.modules.length).toBe(sources.length);
    expect(
      doc.modules.every((m: { id: string }) => m.id.startsWith("src/")),
    ).toBe(true);
    expect(
      doc.edges.some(
        (e: { from: string; to: string; kind: string }) =>
          e.from === "src/bin.ts" &&
          e.to === "src/cli.ts" &&
          e.kind === "depends",
      ),
    ).toBe(true);
    expect(doc.foreign.map((f: { name: string }) => f.name)).toEqual([
      "ajv",
      "node:child_process",
      "node:fs",
      "node:os",
      "node:path",
      "node:util",
      "yaml",
    ]);
    expect(
      doc.edges.some((e: { to: string }) => e.to.includes("scan.schema")),
    ).toBe(false);
  });
});
