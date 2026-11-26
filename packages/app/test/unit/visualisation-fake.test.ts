import { describe, expect, it } from "vitest";
import { parseViewFile, serialiseView } from "../../src/view-file";
import { createVisualisationFake } from "../../src/visualisation-fake";

const TEXT = JSON.stringify({
  schema_version: 1,
  description: "An empty view.",
  commit: null,
  steps: [],
});

describe("visualisation fake", () => {
  it("parses a view text into the view fields", async () => {
    const parsed = await createVisualisationFake().parse(TEXT);

    expect(parsed.ok).toBe(true);

    if (parsed.ok) {
      expect(parsed.view.description).toBe("An empty view.");
      expect(parsed.view.steps).toEqual([]);
      expect(parsed.warnings).toEqual(parsed.view.noteWarnings());
    }
  });

  it("refuses text that is not JSON, not a view, or blank", async () => {
    const fake = createVisualisationFake();
    const blank = JSON.stringify({
      schema_version: 1,
      description: " ",
      commit: null,
      steps: [],
    });

    expect(await fake.parse("{")).toMatchObject({ ok: false });
    expect(await fake.parse("{}")).toEqual({
      ok: false,
      reason: "view is invalid",
    });
    expect(await fake.parse(blank)).toEqual({
      ok: false,
      reason: "description must not be blank",
    });
  });

  it("serialises through the same view fields the parse returns", async () => {
    const fake = createVisualisationFake();
    const parsed = parseViewFile(TEXT);

    if (!parsed.ok) {
      throw new Error("parse failed");
    }

    const text = await fake.serialise(parsed.view);

    expect(text).toBe(serialiseView(parsed.view));
    expect(text.endsWith("\n")).toBe(true);
    expect(JSON.parse(text).description).toBe("An empty view.");
  });
});
