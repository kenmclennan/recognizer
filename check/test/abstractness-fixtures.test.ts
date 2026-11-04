import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isAbstract, measureFolders } from "../src/folder-metrics.js";
import { validateScan } from "../src/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures");

interface Label {
  folder: string;
  exported_members: number;
  abstract_members: number;
  abstractness: number;
  distance: number | null;
  members: Record<string, boolean>;
}

const expected = JSON.parse(
  readFileSync(join(root, "abstractness/expected.json"), "utf8"),
) as Record<string, Label>;

describe.each(Object.keys(expected))("abstractness fixture %s", (language) => {
  const label = expected[language] as Label;
  const scan = validateScan(
    JSON.parse(
      readFileSync(
        join(root, `abstractness/${language}/expected-scan.json`),
        "utf8",
      ),
    ),
  );

  it("measures the labelled folder", () => {
    const { rows } = measureFolders([scan], null);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: label.folder,
      exported_members: label.exported_members,
      abstract_members: label.abstract_members,
      abstractness: label.abstractness,
      distance: label.distance,
    });
  });

  it("agrees with every member label and has none unlabelled", () => {
    const exported = scan.modules
      .flatMap((module) => module.members ?? [])
      .filter((member) => member.exported);
    const names = exported.map((member) => member.name);

    for (const name of Object.keys(label.members)) {
      expect(names, `label without a scan member: ${name}`).toContain(name);
    }

    for (const member of exported) {
      expect(
        Object.keys(label.members),
        `scan member without a label: ${member.name}`,
      ).toContain(member.name);
      expect(isAbstract(member), member.name).toBe(label.members[member.name]);
    }
  });
});
