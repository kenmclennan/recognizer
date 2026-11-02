import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { serialiseView as cliSerialise } from "recognizer";
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
      `${JSON.stringify({ schema_version: 4, description: "d", commit: null, steps: view.steps }, null, 2)}\n`,
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

  it("round-trips notes in key order, in the order they were added", () => {
    const view = {
      schema_version: 3 as const,
      description: "d",
      commit: null,
      steps: [],
      notes: [
        { module: "b.py", text: "B", by: "Ken" },
        { module: "a.py", text: "A", by: "Claude" },
      ],
    };
    const text = serialiseView(view);

    expect(Object.keys(JSON.parse(text))).toEqual([
      "schema_version",
      "description",
      "commit",
      "notes",
      "steps",
    ]);

    const parsed = parseViewFile(text);

    expect(parsed.ok && parsed.view.notes).toEqual(view.notes);
  });

  it("writes a version 2 view with both note kinds at version 4 without the view note", () => {
    const text = serialiseView({
      schema_version: 2,
      description: "d",
      commit: null,
      note: { text: "V", by: "Ken" },
      module_notes: { "a.py": { text: "A", by: "Claude" } },
      steps: [],
    });
    const written = JSON.parse(text);

    expect(written.schema_version).toBe(4);
    expect(written.note).toBeUndefined();
    expect(written.module_notes).toBeUndefined();
    expect(written.notes).toEqual([
      { module: "a.py", text: "A", by: "Claude" },
    ]);
  });

  it("writes the committed version 4 example back to the same bytes", () => {
    const text = readFileSync(join(EXAMPLES, "version-4-lens.json"), "utf8");
    const parsed = parseViewFile(text);

    expect(parsed.ok && serialiseView(parsed.view)).toBe(text);
  });

  it("writes a version 1 view at version 4", () => {
    const text = serialiseView({
      schema_version: 1,
      description: "d",
      commit: null,
      steps: [],
    });

    expect(JSON.parse(text).schema_version).toBe(4);
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

describe("parseViewFile warnings", () => {
  it("returns no warning for one note per path and one warning for several on a path", () => {
    const view = (notes: { module: string; text: string; by: string }[]) =>
      JSON.stringify({
        schema_version: 3,
        description: "d",
        commit: null,
        notes,
        steps: [],
      });
    const clean = parseViewFile(
      view([{ module: "a.py", text: "t", by: "Ken" }]),
    );
    const doubled = parseViewFile(
      view([
        { module: "a.py", text: "one", by: "Ken" },
        { module: "a.py", text: "two", by: "Claude" },
      ]),
    );

    expect(clean).toMatchObject({ ok: true, warnings: [] });
    expect(doubled.ok && doubled.warnings).toEqual([
      "view holds 1 note on a.py; kept the last on each",
    ]);
  });

  it("gives the app and the command byte-identical text for one view", () => {
    const view = {
      schema_version: 4 as const,
      ordered: false,
      description: "d",
      commit: "abc",
      notes: [{ module: "b.py", text: "B", by: "Ken" }],
      steps: [{ kind: "pick" as const, module: "b.py" }],
    };

    expect(serialiseView(view)).toBe(cliSerialise(view));
    expect(Object.keys(JSON.parse(serialiseView(view)))).toEqual([
      "schema_version",
      "description",
      "commit",
      "ordered",
      "notes",
      "steps",
    ]);
  });
});
