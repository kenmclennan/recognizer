import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseViewFile,
  serialiseView,
} from "../src/adapters/filesystem/view-translator.js";
import { REPO } from "./helpers.js";

const EXAMPLES = join(REPO, "schema/view-examples");
const VALID = readdirSync(join(EXAMPLES, "valid"));
const INVALID = readdirSync(join(EXAMPLES, "invalid"));

function textOf(folder: string, file: string): string {
  return readFileSync(join(EXAMPLES, folder, file), "utf8");
}

describe("view translator", () => {
  it.each(VALID)("parses %s and serialises it stably", (file) => {
    const parsed = parseViewFile(textOf("valid", file));

    expect(parsed.ok).toBe(true);

    if (parsed.ok) {
      const once = serialiseView(parsed.view);
      const again = parseViewFile(once);

      expect(again.ok).toBe(true);

      if (again.ok) {
        expect(serialiseView(again.view)).toBe(once);
        expect(again.view.sameContent(parsed.view)).toBe(true);
      }
    }
  });

  it.each(VALID)(
    "serialises %s byte-identically when it is canonical",
    (file) => {
      const text = textOf("valid", file);
      const parsed = parseViewFile(text);

      if (parsed.ok && JSON.parse(text).schema_version === 4) {
        const canonical = serialiseView(parsed.view);

        expect(canonical).toBe(
          `${JSON.stringify(JSON.parse(canonical), null, 2)}\n`,
        );
      }
    },
  );

  it.each(INVALID)("rejects %s", (file) => {
    expect(parseViewFile(textOf("invalid", file)).ok).toBe(false);
  });

  it("sameContent agrees with comparing serialised text across the valid examples", () => {
    const views = VALID.flatMap((file) => {
      const parsed = parseViewFile(textOf("valid", file));

      return parsed.ok ? [parsed.view] : [];
    });

    for (const a of views) {
      for (const b of views) {
        expect(a.sameContent(b)).toBe(serialiseView(a) === serialiseView(b));
      }
    }
  });
});
