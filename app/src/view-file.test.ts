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
      `${JSON.stringify({ schema_version: 2, description: "d", commit: null, steps: view.steps }, null, 2)}\n`,
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

  it("round-trips notes in key order with module notes sorted", () => {
    const view = {
      schema_version: 2 as const,
      description: "d",
      commit: null,
      steps: [],
      module_notes: {
        "b.py": { text: "B", by: "Ken" },
        "a.py": { text: "A", by: "Claude" },
      },
      note: { text: "V", by: "Ken" },
    };
    const text = serialiseView(view);

    expect(Object.keys(JSON.parse(text))).toEqual([
      "schema_version",
      "description",
      "commit",
      "note",
      "module_notes",
      "steps",
    ]);
    expect(Object.keys(JSON.parse(text).module_notes)).toEqual([
      "a.py",
      "b.py",
    ]);

    const parsed = parseViewFile(text);

    expect(parsed.ok && parsed.view.note).toEqual({ text: "V", by: "Ken" });
    expect(parsed.ok && parsed.view.module_notes?.["a.py"]).toEqual({
      text: "A",
      by: "Claude",
    });
  });

  it("writes a version 1 view at version 2", () => {
    const text = serialiseView({
      schema_version: 1,
      description: "d",
      commit: null,
      steps: [],
    });

    expect(JSON.parse(text).schema_version).toBe(2);
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
