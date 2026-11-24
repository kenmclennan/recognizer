import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KeyOwnersAdapter } from "../src/adapters/plugins/key-owners-adapter.js";
import { REPO } from "./helpers.js";
import { fakeIo } from "./scan-helpers.js";
import { exampleManifest } from "./shipped-read.js";

const PINNED = JSON.parse(
  readFileSync(join(REPO, "fixtures/sensors/config-keys.json"), "utf8"),
) as { keys: { key: string }[]; sections: { key: string }[] };

function adapterFor(options: Parameters<typeof fakeIo>[0]) {
  return new KeyOwnersAdapter(fakeIo(options).io);
}

function manifestProgram(manifest: unknown) {
  return () => ({ stdout: JSON.stringify(manifest) });
}

describe("KeyOwnersAdapter", () => {
  it("builds the tests keys from the shipped sensors' manifests, as the pinned schema holds them", () => {
    const { schema, notAnswering } = adapterFor({
      sensorManifests: true,
    }).schemas();

    expect(notAnswering).toEqual([]);
    expect(schema).toEqual(PINNED);
  });

  it("holds no tests section when no sensor answers", () => {
    const { schema } = adapterFor({}).schemas();

    expect(schema.sections).toEqual([]);
    expect(schema.keys.some((entry) => entry.key.startsWith("tests."))).toBe(
      false,
    );
  });

  it("reports a sensor whose suite key differs from another's and leaves its suite keys out", () => {
    const mutation = exampleManifest("mutation");
    const suite = mutation.suite_keys as {
      section: unknown;
      keys: { key: string }[];
    };
    const conflicting = {
      ...mutation,
      suite_keys: {
        ...suite,
        keys: suite.keys.map((entry) =>
          entry.key === "tests.<name>.command"
            ? { ...entry, description: "something else" }
            : entry,
        ),
      },
    };
    const { schema, notAnswering } = adapterFor({
      sensorManifests: true,
      programs: { "recognizer-sense-mutation": manifestProgram(conflicting) },
    }).schemas();

    expect(notAnswering).toHaveLength(1);
    expect(notAnswering[0]).toContain("recognizer-sense-mutation");
    expect(notAnswering[0]).toContain("tests.<name>.command");
    expect(
      schema.keys.find((entry) => entry.key === "tests.<name>.command")
        ?.description,
    ).not.toBe("something else");
  });
});
