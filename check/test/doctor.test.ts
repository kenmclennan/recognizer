import { describe, expect, it } from "vitest";
import { unsetValue } from "../src/config-edit.js";
import { loadKeys } from "../src/config-keys.js";
import { RETIRED_KEYS } from "../src/config-retired.js";
import { fakeIo, ROOT } from "./scan-helpers.js";

describe("retired keys are unsettable", () => {
  const published = loadKeys(fakeIo().io, ROOT);
  const sampleFor = (path: string[]) =>
    path.length === 1
      ? "overlays:\n  crap:\n    command: [x]\n"
      : `sensors:\n  structure:\n${
          path.length === 4
            ? `    warnings:\n      ${path[3]}: true\n`
            : `    ${path[2]}: 1\n`
        }`;

  it.each(RETIRED_KEYS.map((retired) => [retired.path.join(".")]))(
    "unsets %s",
    (key) => {
      const path = key.split(".");
      const text = sampleFor(path);

      const outcome = unsetValue(text, published, key);

      expect(outcome.status).toBe("ok");

      const after = (outcome as { text: string }).text;

      expect(after).not.toMatch(path[path.length - 1] as string);
    },
  );

  it("reports a retired key not in the document as absent", () => {
    expect(
      unsetValue(
        "sensors:\n  crap:\n    threshold: 1\n",
        published,
        "overlays",
      ),
    ).toEqual({ status: "absent" });
    expect(
      unsetValue(
        "sensors:\n  structure:\n    warnings:\n      cycle: true\n",
        published,
        "sensors.structure.hub_threshold",
      ),
    ).toEqual({ status: "absent" });
  });

  it("still refuses an unknown key", () => {
    expect(
      unsetValue(
        "sensors:\n  crap:\n",
        published,
        "sensors.structure.nonsense",
      ),
    ).toMatchObject({ status: "refused" });
  });
});
