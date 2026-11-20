import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { REPO } from "./helpers.js";
import { fakeIo, ROOT } from "./scan-helpers.js";

type Expected = {
  name: string;
  signature: string;
  fields: string[];
  methods: string[];
};

const read = (path: string) => readFileSync(join(REPO, path), "utf8");
const expected = JSON.parse(read("fixtures/signatures.json")) as Record<
  string,
  Record<string, Expected[]>
>;

function show(scan: Record<string, unknown>, id: string) {
  const fake = fakeIo({
    commit: "abc123",
    files: {
      [`${ROOT}/a.py`]: "",
      [`${ROOT}/.recognizer/cache/scan.python.json`]: JSON.stringify({
        ...scan,
        commit: "abc123",
        modified: false,
        files: [],
      }),
    },
  });

  run(["show", id, "--private", "--json", "--repository", ROOT], fake.io);

  return JSON.parse(fake.out()).members as {
    name: string;
    signature: string;
    fields?: { signature: string }[];
    methods?: { signature: string }[];
  }[];
}

describe("signatures shared with the inspector", () => {
  for (const [file, modules] of Object.entries(expected)) {
    it(`prints the signatures of ${file} that the inspector shows`, () => {
      const scan = JSON.parse(read(file));

      for (const [id, members] of Object.entries(modules)) {
        const shown = show(scan, id);

        expect(shown.map((member) => [member.name, member.signature])).toEqual(
          members.map((member) => [member.name, member.signature]),
        );
        expect(
          shown.map((member) => (member.fields ?? []).map((f) => f.signature)),
        ).toEqual(members.map((member) => member.fields));
        expect(
          shown.map((member) => (member.methods ?? []).map((m) => m.signature)),
        ).toEqual(members.map((member) => member.methods));
      }
    });
  }
});
