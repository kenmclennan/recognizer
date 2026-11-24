import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { installedSensors } from "../../src/installed-fake";

const EXAMPLES = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../schema/manifest-examples/valid",
);

describe("installed-fake", () => {
  it("installedSensors lists exactly the committed sensor examples", () => {
    const files = readdirSync(EXAMPLES)
      .filter((file) => /^sensor-.+\.json$/.test(file))
      .sort();
    const sensors = installedSensors();

    expect(files.length).toBeGreaterThan(0);
    expect(sensors.map(({ name }) => `sensor-${name}.json`)).toEqual(files);

    for (const [at, file] of files.entries()) {
      const example = JSON.parse(readFileSync(join(EXAMPLES, file), "utf8"));

      expect(sensors[at]?.plannedWork).toEqual(example.planned_work);
      expect(sensors[at]?.logPath).toEqual(example.log_path);
    }
  });
});
