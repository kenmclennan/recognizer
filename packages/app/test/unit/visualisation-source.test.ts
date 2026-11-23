import { describe, expect, it } from "vitest";
import { CoreUnavailable } from "../../src/scan-source";
import { createVisualisationSource } from "../../src/visualisation-source";

const FIELDS = {
  schema_version: 1,
  description: "An empty view.",
  commit: null,
  steps: [],
};

function stubbed(reply: unknown) {
  const calls: { command: string; args: Record<string, unknown> }[] = [];

  const source = createVisualisationSource(
    async <T>(command: string, args: Record<string, unknown> = {}) => {
      calls.push({ command, args });

      return reply as T;
    },
  );

  return { source, calls };
}

describe("visualisation source", () => {
  it("parse calls core with view.parse and builds a view from the reply", async () => {
    const { source, calls } = stubbed({
      ok: { ok: true, view: FIELDS, warnings: ["w"] },
    });

    const parsed = await source.parse("text");

    expect(calls).toEqual([
      {
        command: "core_call",
        args: { op: "view.parse", args: { text: "text" } },
      },
    ]);
    expect(parsed.ok).toBe(true);

    if (parsed.ok) {
      expect(parsed.view.description).toBe("An empty view.");
      expect(parsed.warnings).toEqual(["w"]);
    }
  });

  it("parse maps a refused text to its reason", async () => {
    const { source } = stubbed({
      ok: { ok: false, reason: "view is invalid" },
    });

    expect(await source.parse("{}")).toEqual({
      ok: false,
      reason: "view is invalid",
    });
  });

  it("serialise calls core with view.serialise and returns the text", async () => {
    const { source, calls } = stubbed({ ok: { text: "{}\n" } });

    expect(await source.serialise(FIELDS as never)).toBe("{}\n");
    expect(calls[0]).toEqual({
      command: "core_call",
      args: { op: "view.serialise", args: { view: FIELDS } },
    });
  });

  it("an unavailable or error reply rejects", async () => {
    const unavailable = stubbed({
      unavailable: { kind: "missing", hint: "x" },
    });
    const failed = stubbed({ error: "boom" });

    await expect(unavailable.source.parse("t")).rejects.toBeInstanceOf(
      CoreUnavailable,
    );
    await expect(failed.source.serialise(FIELDS as never)).rejects.toThrow(
      "boom",
    );
  });
});
