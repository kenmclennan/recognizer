import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../scripts/temp-dirs.mjs";
import { nodeIo, run } from "../src/cli.js";
import { parsePolicy } from "../src/policy.js";
import { REPO } from "./helpers.js";
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

const fixture = (name: string) =>
  readFileSync(join(REPO, "fixtures/policy-edit", name), "utf8");

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

  const unsettable = [
    "components:",
    "  domain:",
    "    - shop/domain/**",
    "  ports:",
    "    - shop/ports/**",
    "  extra:",
    "    - shop/extra/**",
    "levels:",
    "  - ports",
    "uses:",
    "  ports:",
    "    - ports",
    "  extra:",
    "    - ports",
    "forbid:",
    "  - a/** -> b/**",
    "foreign:",
    "  http:",
    "    - requests",
    "  other:",
    "    - z",
    "ignore:",
    "  - tests/**",
    "",
  ].join("\n");

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

      it("--unset <key> <value> deletes that item", () => {
        const fake = setup(withAdapters);

        expect(policy(fake, "--add", key, item)).toBe(0);
        expect(policy(fake, "--unset", key, item)).toBe(0);
        expect(fake.files.get(POLICY)).toBe(withAdapters);
      });

      it("--unset <key> deletes the key", () => {
        const fake = setup(unsettable);
        expect(policy(fake, "--unset", key)).toBe(0);

        const after = fake.files.get(POLICY) as string;

        expect(after).not.toBe(unsettable);
        expect(policy(fake, "--get", key)).toBe(1);
      });
    });
  }
});

describe("recognizer policy sections", () => {
  it("--add-section components writes an empty map on a new file", () => {
    const fake = setup(null);

    expect(policy(fake, "--add-section", "components")).toBe(0);
    expect(fake.files.get(POLICY)).toBe("components: {}\n");
  });

  it("--add-section foreign writes an empty map", () => {
    const fake = setup(null);

    expect(policy(fake, "--add-section", "foreign")).toBe(0);
    expect(fake.files.get(POLICY)).toBe("foreign: {}\n");
  });

  it("--add-section uses is refused with a uses: message and writes nothing", () => {
    const fake = setup("components:\n  a: x/**\n");

    expect(policy(fake, "--add-section", "uses")).toBe(2);
    expect(fake.err()).toMatch(/^recognizer policy: uses: /);
    expect(fake.files.get(POLICY)).toBe("components:\n  a: x/**\n");
  });

  it("--remove-section removes components, uses and foreign whole", () => {
    const fake = setup(BASE.replace(/levels:\n( {2}- .*\n)+/, ""));

    expect(policy(fake, "--remove-section", "uses")).toBe(0);
    expect(policy(fake, "--remove-section", "foreign")).toBe(0);
    expect(policy(fake, "--remove-section", "components")).toBe(0);
    expect(fake.files.get(POLICY)).toBe(
      "forbid:\n  - a/** -> b/**\nignore:\n  - tests/**\n",
    );
  });

  it("refuses a key typed as a section and a section typed as a key", () => {
    const fake = setup();

    expect(policy(fake, "--add", "components", "x")).toBe(2);
    expect(fake.err()).toContain("is a section, not a key");
    expect(policy(fake, "--add-section", "components.domain")).toBe(2);
    expect(fake.files.get(POLICY)).toBe(BASE);
  });
});

describe("recognizer policy refuses a write that introduces an error", () => {
  const refused: [string, string[]][] = [
    ["levels", ["--add", "levels", "ghost"]],
    ["uses.ports", ["--add", "uses.ports", "ghost"]],
    ["forbid", ["--add", "forbid", "no arrow"]],
    ["components.domain", ["--add", "components.domain", ""]],
    ["components.domain", ["--unset", "components.domain"]],
  ];

  it.each(refused)("%s: %j leaves the file byte-identical", (key, argv) => {
    const fake = setup();

    expect(policy(fake, ...argv)).toBe(2);
    expect(fake.err().startsWith(`recognizer policy: ${argv[1]}:`)).toBe(true);
    expect(fake.files.get(POLICY)).toBe(BASE);
    expect(key).toBe(argv[1]);
  });

  it("names the component a levels entry lacks", () => {
    const fake = setup();

    policy(fake, "--add", "levels", "ghost");

    expect(fake.err()).toContain('"ghost" is not in components');
  });

  it("saves a valid edit elsewhere in a file that already has an error", () => {
    const broken = `${BASE}`.replace(
      "levels:\n  - domain\n  - ports\n",
      "levels:\n  - domain\n  - nowhere\n",
    );
    const fake = setup(broken);

    expect(policy(fake, "--add", "ignore", "docs/**")).toBe(0);
    expect(fake.files.get(POLICY)).toBe(`${broken}  - docs/**\n`);
  });

  it("refuses an edit that adds a second error, naming only the new one", () => {
    const broken = `${BASE}`.replace(
      "levels:\n  - domain\n  - ports\n",
      "levels:\n  - domain\n  - nowhere\n",
    );
    const fake = setup(broken);

    expect(policy(fake, "--add", "uses.ports", "ghost")).toBe(2);
    expect(fake.err()).toContain("ghost");
    expect(fake.err()).not.toContain("nowhere");
    expect(fake.files.get(POLICY)).toBe(broken);
  });

  it("lets the one bad entry be unset while other errors remain", () => {
    const broken = `${BASE}`.replace(
      "levels:\n  - domain\n  - ports\n",
      "levels:\n  - domain\n  - nowhere\n",
    );
    const fake = setup(broken);

    expect(policy(fake, "--unset", "levels", "nowhere")).toBe(0);
    expect(fake.files.get(POLICY)).not.toContain("nowhere");
  });
});

describe("recognizer policy keeps the file's text", () => {
  function lines(text: string): string[] {
    return text.split("\n");
  }

  it("keeps comments, blank lines, order, a scalar and a flow list through an add and an unset", () => {
    const input = fixture("commented.yaml");
    const fake = setup(input);

    expect(lines(input).filter((line) => line.includes("#")).length).toBe(3);
    expect(policy(fake, "--add", "components.ports", "shop/ports3/**")).toBe(0);

    const added = fake.files.get(POLICY) as string;

    expect(added).toBe(fixture("commented.added.yaml"));
    expect(policy(fake, "--unset", "ignore", "tests/**")).toBe(0);

    const unset = fake.files.get(POLICY) as string;

    expect(unset).toBe(fixture("commented.unset.yaml"));

    for (const line of lines(input).filter(
      (l) => !l.includes("ignore") && !l.includes("tests/**"),
    )) {
      expect(lines(unset)).toContain(line);
    }

    const kept = lines(input).filter((line) => lines(unset).includes(line));

    expect(
      lines(unset.trimEnd()).filter((line) => !line.includes("ports3")),
    ).toEqual(lines(input.replace(/\nignore:.*\n$/, "").trimEnd()));
  });

  it("keeps a four-space indent", () => {
    const fake = setup(fixture("four-space.yaml"));

    expect(policy(fake, "--add", "components.domain", "shop/x/**")).toBe(0);
    expect(fake.files.get(POLICY)).toBe(fixture("four-space.added.yaml"));
  });

  it("refuses --add onto a scalar and converts it by unset then add", () => {
    const fake = setup("components:\n  domain: shop/domain/**\n");

    expect(policy(fake, "--add", "components.domain", "x/**")).toBe(2);
    expect(fake.err()).toContain("components.domain is a scalar, not a list");
    expect(policy(fake, "--get", "components.domain")).toBe(0);
    expect(fake.out()).toBe("shop/domain/**\n");
  });

  it("reports a path --list cannot address and exits 1", () => {
    const fake = setup("components:\n  a.b: x/**\n  c: y/**\n");

    expect(policy(fake, "--list")).toBe(1);
    expect(fake.out()).toBe("components.c=y/**\n");
    expect(fake.err()).toContain("cannot be addressed");
  });

  it("does not let a component named command block writes under components", () => {
    const fake = setup("components:\n  command: x/**\n");

    expect(policy(fake, "--add", "components.x", "y/**")).toBe(0);
    expect(fake.files.get(POLICY)).toContain("x:");
  });
});

describe("recognizer policy with no policy file", () => {
  it.each([
    ["--get", "levels"],
    ["--list"],
    ["--unset", "levels"],
    ["--remove-section", "components"],
  ])("%s exits 1 saying there is no policy and creates nothing", (...argv) => {
    const fake = setup(null);

    expect(policy(fake, ...argv)).toBe(1);
    expect(fake.err()).toBe(
      "recognizer policy: there is no policy at .recognizer/policy.yaml\n",
    );
    expect(
      [...fake.files.keys()].some((key) => key.includes(".recognizer")),
    ).toBe(false);
  });

  it("the first write creates the folder and a file that parses", () => {
    const root = makeTempDir("policy-first-");
    const io = nodeIo();
    const code = run(
      [
        "policy",
        "--repository",
        root,
        "--add",
        "components.domain",
        "src/domain/**",
      ],
      io,
    );
    const file = join(root, ".recognizer", "policy.yaml");

    expect(code).toBe(0);
    expect(existsSync(file)).toBe(true);
    expect(parsePolicy(readFileSync(file, "utf8")).components).toBeDefined();
  });
});

describe("recognizer policy argument shapes", () => {
  it.each([
    [["--add", "levels"]],
    [["--get"]],
    [["--list", "levels"]],
    [["--add", "--get", "levels"]],
    [["--add-section"]],
    [["levels", "a", "b"]],
  ])("%j is a usage error", (argv) => {
    const fake = setup();

    expect(policy(fake, ...argv)).toBe(2);
    expect(fake.err()).toContain("usage: recognizer policy");
  });
});

describe("recognizer check over a policy built only through recognizer policy", () => {
  it("gives the same report as the hand-written fixture policy", () => {
    const handWritten = readFileSync(
      join(REPO, "fixtures/check/.recognizer/policy.yaml"),
      "utf8",
    );
    const scan = readFileSync(join(REPO, "fixtures/check/scan.json"), "utf8");
    const expected = JSON.parse(
      readFileSync(join(REPO, "fixtures/check/expected.json"), "utf8"),
    );
    const fake = setup(null);
    const steps: string[][] = [
      ...["domain", "ports", "application", "adapters"].map((name) => [
        "--add",
        `components.${name}`,
        `shop/${name}/**`,
      ]),
      ["--add", "components.entry", "shop/main.py"],
      ...["domain", "ports", "application", "adapters", "entry"].map((name) => [
        "--add",
        "levels",
        name,
      ]),
      ["--add", "forbid", "shop/adapters/* -> shop/adapters/*"],
      ["--add", "forbid", "* -> foreign:requests"],
      ["--add", "ignore", "tests/**"],
    ];

    for (const step of steps) {
      expect(policy(fake, ...step)).toBe(0);
    }

    const written = fake.files.get(POLICY) as string;

    const report = (policyText: string) => {
      const checker = fakeIo({
        files: { "/scan.json": scan, "/policy.yaml": policyText },
      });
      const code = run(
        ["check", "--scan", "/scan.json", "--policy", "/policy.yaml"],
        checker.io,
      );

      return { code, report: JSON.parse(checker.out()) };
    };

    const fromCommand = report(written);
    const fromHand = report(handWritten);

    expect(fromCommand).toEqual(fromHand);
    expect(fromCommand.report.violations).toHaveLength(
      expected.violations.length,
    );
    expect(fromCommand.report.violations.length).toBeGreaterThan(0);
  });
});

describe("recognizer policy help", () => {
  it.each([
    ["help", "policy"],
    ["policy", "--help"],
    ["policy", "-h"],
  ])("%j lists every key with its type and example", (...argv) => {
    const fake = setup();

    expect(run(argv, fake.io)).toBe(0);

    const out = fake.out();

    expect(out).toContain("Keys:");

    for (const key of [
      "components.<name>",
      "levels",
      "uses.<name>",
      "forbid",
      "foreign.<name>",
      "ignore",
    ]) {
      expect(out).toContain(`  ${key}  [recognizer]`);
    }

    expect(out).toContain("list of string: the globs of one component");
    expect(out).toContain(
      "example: recognizer policy --add components.domain src/domain/**",
    );
    expect(out).not.toContain("did not answer");
  });
});
