import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseViewFile, serialiseView } from "./view-file";

const EXAMPLES = join(__dirname, "../../schema/view-examples/valid");

describe("view files", () => {
  it("serialises with the stated key order, two spaces and a trailing newline", () => {
    const view = {
      steps: [{ kind: "pick" as const, module: "a.py" }],
      commit: null,
      description: "d",
      schema_version: 1 as const,
    };
    const text = serialiseView(view);

    expect(text).toBe(
      `${JSON.stringify({ schema_version: 1, description: "d", commit: null, steps: view.steps }, null, 2)}\n`,
    );
    expect(Object.keys(JSON.parse(text))).toEqual([
      "schema_version",
      "description",
      "commit",
      "steps",
    ]);

    const parsed = parseViewFile(text);

    expect(parsed.ok).toBe(true);
  });

  it("rejects a blank description with the reason", () => {
    const parsed = parseViewFile(
      JSON.stringify({
        schema_version: 1,
        description: "  ",
        commit: null,
        steps: [],
      }),
    );

    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? "" : parsed.reason).toContain("description");
  });

  it("rejects text that is not JSON", () => {
    const parsed = parseViewFile("{nope");

    expect(parsed.ok).toBe(false);
  });

  it("accepts every committed valid view example", () => {
    const files = readdirSync(EXAMPLES).filter((name) =>
      name.endsWith(".json"),
    );

    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      expect(parseViewFile(readFileSync(join(EXAMPLES, file), "utf8")).ok).toBe(
        true,
      );
    }
  });
});
