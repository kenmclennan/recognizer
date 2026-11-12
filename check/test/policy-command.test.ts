import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { fakeIo, ROOT } from "./scan-helpers.js";

const POLICY = `${ROOT}/.recognizer/policy.yaml`;

const BASE = [
  "components:",
  "  domain:",
  "    - shop/domain/**",
  "  ports:",
  "    - shop/ports/**",
  "levels:",
  "  - domain",
  "  - ports",
  "uses:",
  "  ports:",
  "    - domain",
  "forbid:",
  "  - a/** -> b/**",
  "foreign:",
  "  http:",
  "    - requests",
  "ignore:",
  "  - tests/**",
  "",
].join("\n");

function setup(text: string | null = BASE) {
  return fakeIo({ files: text === null ? {} : { [POLICY]: text } });
}

function policy(fake: ReturnType<typeof fakeIo>, ...argv: string[]) {
  return run(["policy", "--repository", ROOT, ...argv], fake.io);
}

describe("recognizer policy, per key", () => {
  const keys = [
    {
      key: "components.domain",
      item: "shop/extra/**",
      first: "shop/domain/**",
    },
    { key: "levels", item: "adapters", first: "domain" },
    { key: "uses.ports", item: "adapters", first: "domain" },
    { key: "forbid", item: "c/** -> d/**", first: "a/** -> b/**" },
    { key: "foreign.http", item: "urllib", first: "requests" },
    { key: "ignore", item: "docs/**", first: "tests/**" },
  ];

  const withAdapters = `${BASE}`.replace(
    "levels:",
    "  adapters:\n    - shop/adapters/**\nlevels:",
  );

  for (const { key, item, first } of keys) {
    describe(key, () => {
      it("set is refused as a list and leaves the file byte-identical", () => {
        const fake = setup(withAdapters);

        expect(policy(fake, key, item)).toBe(2);
        expect(fake.err()).toMatch(
          new RegExp(`^recognizer policy: ${key.replace(".", "\\.")}: .*list`),
        );
        expect(fake.files.get(POLICY)).toBe(withAdapters);
      });

      it("--add appends the item and a repeat leaves the file byte-identical", () => {
        const fake = setup(withAdapters);

        expect(policy(fake, "--add", key, item)).toBe(0);

        const after = fake.files.get(POLICY) as string;

        expect(after).not.toBe(withAdapters);
        expect(after).toContain(item);
        expect(policy(fake, "--add", key, item)).toBe(0);
        expect(fake.files.get(POLICY)).toBe(after);
      });

      it("--get prints the items one per line", () => {
        const fake = setup();

        expect(policy(fake, "--get", key)).toBe(0);
        expect(fake.out()).toBe(
          `${first}\n${key === "levels" ? "ports\n" : ""}`,
        );
      });

      it("--list includes the key's items", () => {
        const fake = setup();

        expect(policy(fake, "--list")).toBe(0);
        expect(fake.out()).toContain(`${key}=${first}`);
      });
    });
  }
});
