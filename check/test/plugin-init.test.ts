import { describe, expect, it } from "vitest";
import {
  programName,
  renderTemplates,
  templateValues,
} from "../src/plugin-templates.js";

describe("plugin template rendering", () => {
  it("throws on an unknown placeholder", () => {
    expect(() =>
      renderTemplates(
        { "python/scanner/README.md": "hello {{nonsense}}" },
        "python",
        "scanner",
        templateValues("scanner", "demo"),
      ),
    ).toThrow(/unknown placeholder \{\{nonsense\}\}/);
  });

  it("throws when braces remain after rendering", () => {
    const values = templateValues("scanner", "demo");

    expect(() =>
      renderTemplates(
        { "python/scanner/README.md": "open {{ never closed" },
        "python",
        "scanner",
        values,
      ),
    ).toThrow(/still holds/);
  });

  it("fills every placeholder from the protocol and schema versions", () => {
    const values = templateValues("sensor", "demo");

    expect(values.program).toBe(programName("sensor", "demo"));
    expect(Number(values.protocol)).toBeGreaterThan(0);
    expect(Number(values.scan_schema_version)).toBeGreaterThan(0);
    expect(Number(values.findings_version)).toBeGreaterThan(0);
  });
});
