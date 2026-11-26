import { describe, expect, it } from "vitest";
import { validateOverlay } from "../src/overlays.js";
import {
  buildStructureOverlay,
  STRUCTURE_OVERLAY_METRICS,
} from "../src/structure-overlay.js";
import { repositoryFrom } from "./repository-from.js";

const REPOSITORY = repositoryFrom({
  commit: "c1",
  files: [{ path: "a.py", hash: "0".repeat(64) }],
  modules: [{ id: "a.py" }],
});

describe("the structure overlay builder", () => {
  it("declares the three metrics and names recognizer as producer", () => {
    const overlay = buildStructureOverlay({
      commit: "c1",
      modified: false,
      version: "1.0.0",
      repository: REPOSITORY,
      complexity: { "a.py::f": 3 },
      functionLength: { "a.py::f": 4 },
      duplication: [],
    });

    expect(overlay.metrics).toEqual(STRUCTURE_OVERLAY_METRICS);
    expect(overlay.producer).toEqual({ name: "recognizer", version: "1.0.0" });
    expect(overlay.values.complexity).toEqual({ "a.py::f": 3 });
    expect(() =>
      validateOverlay(overlay, {
        commit: "c1",
        modified: false,
        metrics: STRUCTURE_OVERLAY_METRICS,
      }),
    ).not.toThrow();
  });
});
