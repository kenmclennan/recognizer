import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { compilePolicy } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { parsePolicy } from "../src/adapters/filesystem/policy-translator.js";
import { nodeIo, run } from "../src/cli.js";
import { REPO } from "./helpers.js";
import { fakeIo, ROOT } from "./scan-helpers.js";

const POLICY = `${ROOT}/.recognizer/policy.yaml`;

const BASE = [
  "entry:",
  "  - shop/main.py",
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
    { key: "entry", item: "shop/cli.py", first: "shop/main.py" },
    { key: "forbid", item: "c/** -> d/**", first: "a/** -> b/**" },
    { key: "ignore", item: "docs/**", first: "tests/**" },
  ];

  for (const { key, item, first } of keys) {
    describe(key, () => {
      it("set is refused as a list and leaves the file byte-identical", () => {
        const fake = setup();

        expect(policy(fake, key, item)).toBe(2);
        expect(fake.err()).toMatch(
          new RegExp(`^recognizer policy: ${key.replace(".", "\\.")}: .*list`),
        );
        expect(fake.files.get(POLICY)).toBe(BASE);
      });

      it("--add appends the item and a repeat leaves the file byte-identical", () => {
        const fake = setup();

        expect(policy(fake, "--add", key, item)).toBe(0);

        const after = fake.files.get(POLICY) as string;

        expect(after).not.toBe(BASE);
        expect(after).toContain(item);
        expect(policy(fake, "--add", key, item)).toBe(0);
        expect(fake.files.get(POLICY)).toBe(after);
      });

      it("--get prints the items one per line", () => {
        const fake = setup();

        expect(policy(fake, "--get", key)).toBe(0);
        expect(fake.out()).toBe(`${first}\n`);
      });

      it("--list includes the key's items", () => {
        const fake = setup();

        expect(policy(fake, "--list")).toBe(0);
        expect(fake.out()).toContain(`${key}=${first}`);
      });

      it("--unset <key> <value> deletes that item", () => {
        const fake = setup();

        expect(policy(fake, "--add", key, item)).toBe(0);
        expect(policy(fake, "--unset", key, item)).toBe(0);
        expect(fake.files.get(POLICY)).toBe(BASE);
      });

      it("--unset <key> deletes the key", () => {
        const fake = setup();

        expect(policy(fake, "--unset", key)).toBe(0);
        expect(fake.files.get(POLICY)).not.toBe(BASE);
        expect(policy(fake, "--get", key)).toBe(1);
      });
    });
  }
});

describe("recognizer policy sections", () => {
  it("--add-section foreign is refused as retired and writes nothing", () => {
    const fake = setup(null);

    expect(policy(fake, "--add-section", "foreign")).toBe(2);
    expect(fake.err()).toMatch(/^recognizer policy: foreign: /);
    expect(fake.files.has(POLICY)).toBe(false);
  });

  it("--add-section of a retired section is refused and writes nothing", () => {
    const fake = setup("ignore:\n  - tests/**\n");

    expect(policy(fake, "--add-section", "uses")).toBe(2);
    expect(fake.err()).toMatch(/^recognizer policy: uses: /);
    expect(fake.files.get(POLICY)).toBe("ignore:\n  - tests/**\n");
  });

  it("--remove-section of the retired foreign section is refused and writes nothing", () => {
    const fake = setup();

    expect(policy(fake, "--remove-section", "foreign")).toBe(2);
    expect(fake.err()).toMatch(/^recognizer policy: foreign: /);
    expect(fake.files.get(POLICY)).toBe(BASE);
  });

  it("refuses a key typed as a section and a section typed as a key", () => {
    const fake = setup();

    expect(policy(fake, "--add", "foreign", "x")).toBe(2);
    expect(fake.err()).toMatch(/^recognizer policy: foreign: /);
    expect(policy(fake, "--add-section", "foreign.http")).toBe(2);
    expect(fake.files.get(POLICY)).toBe(BASE);
  });
});

describe("recognizer policy refuses a write that introduces an error", () => {
  const refused: [string, string[]][] = [
    ["forbid", ["--add", "forbid", "no arrow"]],
    ["entry", ["--add", "entry", ""]],
  ];

  it.each(refused)("%s: %j leaves the file byte-identical", (key, argv) => {
    const fake = setup();

    expect(policy(fake, ...argv)).toBe(2);
    expect(fake.err().startsWith(`recognizer policy: ${argv[1]}:`)).toBe(true);
    expect(fake.files.get(POLICY)).toBe(BASE);
    expect(key).toBe(argv[1]);
  });

  it("saves a valid edit elsewhere in a file that already has an error", () => {
    const broken = `${BASE}`.replace(
      "  - a/** -> b/**\n",
      "  - a/** -> b/**\n  - nope\n",
    );
    const fake = setup(broken);

    expect(policy(fake, "--add", "ignore", "docs/**")).toBe(0);
    expect(fake.files.get(POLICY)).toBe(`${broken}  - docs/**\n`);
  });

  it("refuses an edit that adds a second error, naming only the new one", () => {
    const broken = `${BASE}`.replace(
      "  - a/** -> b/**\n",
      "  - a/** -> b/**\n  - nope\n",
    );
    const fake = setup(broken);

    expect(policy(fake, "--add", "forbid", "also bad")).toBe(2);
    expect(fake.err()).toContain("also bad");
    expect(fake.err()).not.toContain("nope");
    expect(fake.files.get(POLICY)).toBe(broken);
  });

  it("lets the one bad entry be unset while other errors remain", () => {
    const broken = `${BASE}`.replace(
      "  - a/** -> b/**\n",
      "  - a/** -> b/**\n  - nope\n",
    );
    const fake = setup(broken);

    expect(policy(fake, "--unset", "forbid", "nope")).toBe(0);
    expect(fake.files.get(POLICY)).not.toContain("nope");
  });
});

describe("recognizer policy --add-forbid", () => {
  it("appends a mapping rule and a repeat changes nothing", () => {
    const fake = setup(BASE.replace("foreign:\n  http:\n    - requests\n", ""));

    expect(
      policy(
        fake,
        "--add-forbid",
        "--from",
        "src/domain/**",
        "--from",
        "src/ports/**",
        "--to",
        "src/adapters/**",
      ),
    ).toBe(0);

    const after = fake.files.get(POLICY) as string;

    expect(after).toContain(
      "  - from: [src/domain/**, src/ports/**]\n    to: [src/adapters/**]\n",
    );
    expect(
      parsePolicy(after).filter((rule) => rule.type === "forbid"),
    ).toHaveLength(2);
    expect(
      policy(
        fake,
        "--add-forbid",
        "--from",
        "src/domain/**",
        "--from",
        "src/ports/**",
        "--to",
        "src/adapters/**",
      ),
    ).toBe(0);
    expect(fake.files.get(POLICY)).toBe(after);
  });

  it("creates the policy on the first write", () => {
    const fake = setup(null);

    expect(policy(fake, "--add-forbid", "--from", "a/**", "--to", "b/**")).toBe(
      0,
    );
    expect(fake.files.get(POLICY)).toBe(
      "forbid:\n  - from: [a/**]\n    to: [b/**]\n",
    );
  });

  it("keeps the comments and layout of commented.yaml", () => {
    const fake = setup(fixture("commented.yaml"));

    expect(
      policy(
        fake,
        "--add-forbid",
        "--from",
        "shop/ui/**",
        "--to",
        "shop/db/**",
        "--to",
        "shop/cache/**",
      ),
    ).toBe(0);

    const after = fake.files.get(POLICY) as string;

    expect(after).toBe(
      fixture("commented.yaml").replace(
        "\nignore:",
        "  - from: [shop/ui/**]\n    to: [shop/db/**, shop/cache/**]\n\nignore:",
      ),
    );
  });

  it.each([
    [["--add-forbid", "--to", "b/**"]],
    [["--add-forbid", "--from", "a/**"]],
    [["--add-forbid"]],
    [["--add-forbid", "--migrate"]],
  ])("%j is a usage error and writes nothing", (argv) => {
    const fake = setup();

    expect(policy(fake, ...argv)).toBe(2);
    expect(fake.err()).toContain("usage: recognizer policy");
    expect(fake.files.get(POLICY)).toBe(BASE);
  });

  it("refuses a write that would introduce an error", () => {
    const fake = setup();

    expect(policy(fake, "--add-forbid", "--from", " ", "--to", "b/**")).toBe(2);
    expect(fake.files.get(POLICY)).toBe(BASE);
  });
});

describe("recognizer policy lists a list rule", () => {
  const WITH_RULE =
    "forbid:\n  - from: [a/**]\n    to: [b/**, c/**]\n  - x/** -> y/**\n";

  it("--list prints a mapping entry as forbid= followed by its JSON", () => {
    const fake = setup(WITH_RULE);

    expect(policy(fake, "--list")).toBe(0);
    expect(fake.out()).toBe(
      'forbid={"from":["a/**"],"to":["b/**","c/**"]}\nforbid=x/** -> y/**\n',
    );
  });

  it("--unset forbid <string rule> leaves a mapping entry in place", () => {
    const fake = setup(WITH_RULE);

    expect(policy(fake, "--unset", "forbid", "x/** -> y/**")).toBe(0);
    expect(fake.files.get(POLICY)).toBe(
      "forbid:\n  - from: [a/**]\n    to: [b/**, c/**]\n",
    );
  });
});

describe("recognizer policy --unset forbid with a mapping rule", () => {
  const WITH_RULE =
    "forbid:\n  - from: [a/**]\n    to: [b/**, c/**]\n  - x/** -> y/**\n";

  it("removes the rule named as --list prints it", () => {
    const fake = setup(WITH_RULE);

    expect(
      policy(
        fake,
        "--unset",
        "forbid",
        'forbid={"from":["a/**"],"to":["b/**","c/**"]}',
      ),
    ).toBe(0);
    expect(fake.files.get(POLICY)).toBe("forbid:\n  - x/** -> y/**\n");
  });

  it("exits 1 and changes nothing when no rule matches", () => {
    const fake = setup(WITH_RULE);

    expect(
      policy(
        fake,
        "--unset",
        "forbid",
        'forbid={"from":["z/**"],"to":["b/**"]}',
      ),
    ).toBe(1);
    expect(fake.files.get(POLICY)).toBe(WITH_RULE);
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
    expect(policy(fake, "--add", "forbid", "shop/ui/** -> shop/db/**")).toBe(0);

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
  });

  it("keeps a four-space indent", () => {
    const fake = setup(fixture("four-space.yaml"));

    expect(policy(fake, "--add", "entry", "shop/x.py")).toBe(0);
    expect(fake.files.get(POLICY)).toBe(fixture("four-space.added.yaml"));
  });

  it("refuses --add onto a scalar and converts it by unset then add", () => {
    const fake = setup("entry: shop/main.py\n");

    expect(policy(fake, "--add", "entry", "x")).toBe(2);
    expect(fake.err()).toContain("entry is a scalar, not a list");
    expect(policy(fake, "--get", "entry")).toBe(0);
    expect(fake.out()).toBe("shop/main.py\n");
  });

  it("reports a path --list cannot address and exits 1", () => {
    const fake = setup("foreign:\n  a.b: [x]\n  c: [y]\n");

    expect(policy(fake, "--list")).toBe(1);
    expect(fake.out()).toBe("foreign.c=y\n");
    expect(fake.err()).toContain("cannot be addressed");
  });

  it("--add entry works on a policy with no entry", () => {
    const fake = setup("ignore:\n  - tests/**\n");

    expect(policy(fake, "--add", "entry", "src/main.ts")).toBe(0);
    expect(fake.files.get(POLICY)).toBe(
      "ignore:\n  - tests/**\nentry:\n  - src/main.ts\n",
    );
  });
});

describe("recognizer policy with no policy file", () => {
  it.each([
    ["--get", "entry"],
    ["--list"],
    ["--unset", "entry"],
    ["--remove-section", "foreign"],
    ["--migrate"],
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
      ["policy", "--repository", root, "--add", "entry", "src/main.ts"],
      io,
    );
    const file = join(root, ".recognizer", "policy.yaml");

    expect(code).toBe(0);
    expect(existsSync(file)).toBe(true);
    expect(
      compilePolicy(parsePolicy(readFileSync(file, "utf8"))).entryGlobs,
    ).toEqual(["src/main.ts"]);
  });
});

describe("recognizer policy argument shapes", () => {
  it.each([
    [["--add", "entry"]],
    [["--get"]],
    [["--list", "entry"]],
    [["--add", "--get", "entry"]],
    [["--add-section"]],
    [["entry", "a", "b"]],
  ])("%j is a usage error", (argv) => {
    const fake = setup();

    expect(policy(fake, ...argv)).toBe(2);
    expect(fake.err()).toContain("usage: recognizer policy");
  });
});

describe("recognizer check over a policy built only through recognizer policy", () => {
  it("gives the same report as the committed fixture policy", () => {
    const handWritten = readFileSync(
      join(REPO, "fixtures/check/.recognizer/policy.yaml"),
      "utf8",
    );
    const scan = readFileSync(join(REPO, "fixtures/check/scan.json"), "utf8");
    const expected = JSON.parse(
      readFileSync(join(REPO, "fixtures/check/expected.json"), "utf8"),
    );
    const fake = setup(null);
    const rules: [string[], string[]][] = [
      [
        ["shop/domain/**"],
        [
          "shop/ports/**",
          "shop/application/**",
          "shop/adapters/**",
          "shop/main.py",
        ],
      ],
      [
        ["shop/ports/**"],
        ["shop/application/**", "shop/adapters/**", "shop/main.py"],
      ],
      [["shop/application/**"], ["shop/adapters/**", "shop/main.py"]],
      [["shop/adapters/**"], ["shop/main.py"]],
    ];
    const steps: string[][] = [
      ["--add", "entry", "shop/main.py"],
      ["--add", "forbid", "shop/adapters/* -> shop/adapters/*"],
      ["--add", "forbid", "* -> foreign:requests"],
      ...rules.map(([from, to]) => [
        "--add-forbid",
        ...from.flatMap((glob) => ["--from", glob]),
        ...to.flatMap((glob) => ["--to", glob]),
      ]),
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

    for (const key of ["entry", "forbid", "ignore"]) {
      expect(out).toContain(`  ${key}  [recognizer]`);
    }

    expect(out).not.toContain("foreign");
    expect(out).toContain("example: recognizer policy --add entry src/main.ts");
    expect(out).toContain("--migrate");
    expect(out).toContain("--add-forbid");
    expect(out).not.toContain("did not answer");
  });
});
