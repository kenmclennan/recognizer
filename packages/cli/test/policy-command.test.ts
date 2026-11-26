import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO } from "./helpers.js";
import { checkScenario } from "./support/check-scenario.js";
import { type CliScenario, cliScenario } from "./support/cli-scenario.js";

const POLICY = ".recognizer/policy.yaml";

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
  return cliScenario({
    sample: false,
    files: text === null ? {} : { [POLICY]: text },
  });
}

function policy(scenario: CliScenario, ...argv: string[]) {
  return scenario.run(["policy", "--repository", scenario.repository, ...argv]);
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
      it("set is refused as a list and leaves the file byte-identical", async () => {
        const scenario = setup();
        const result = await policy(scenario, key, item);

        expect(result.exit).toBe(2);
        expect(result.err).toMatch(
          new RegExp(`^recognizer policy: ${key.replace(".", "\\.")}: .*list`),
        );
        expect(scenario.read(POLICY)).toBe(BASE);
      });

      it("--add appends the item and a repeat leaves the file byte-identical", async () => {
        const scenario = setup();

        expect((await policy(scenario, "--add", key, item)).exit).toBe(0);

        const after = scenario.read(POLICY);

        expect(after).not.toBe(BASE);
        expect(after).toContain(item);
        expect((await policy(scenario, "--add", key, item)).exit).toBe(0);
        expect(scenario.read(POLICY)).toBe(after);
      });

      it("--get prints the items one per line", async () => {
        const result = await policy(setup(), "--get", key);

        expect(result.exit).toBe(0);
        expect(result.out).toBe(`${first}\n`);
      });

      it("--list includes the key's items", async () => {
        const result = await policy(setup(), "--list");

        expect(result.exit).toBe(0);
        expect(result.out).toContain(`${key}=${first}`);
      });

      it("--unset <key> <value> deletes that item", async () => {
        const scenario = setup();

        expect((await policy(scenario, "--add", key, item)).exit).toBe(0);
        expect((await policy(scenario, "--unset", key, item)).exit).toBe(0);
        expect(scenario.read(POLICY)).toBe(BASE);
      });

      it("--unset <key> deletes the key", async () => {
        const scenario = setup();

        expect((await policy(scenario, "--unset", key)).exit).toBe(0);
        expect(scenario.read(POLICY)).not.toBe(BASE);
        expect((await policy(scenario, "--get", key)).exit).toBe(1);
      });
    });
  }
});

describe("recognizer policy sections", () => {
  it("--add-section foreign is refused as retired and writes nothing", async () => {
    const scenario = setup(null);
    const result = await policy(scenario, "--add-section", "foreign");

    expect(result.exit).toBe(2);
    expect(result.err).toMatch(/^recognizer policy: foreign: /);
    expect(scenario.exists(POLICY)).toBe(false);
  });

  it("--add-section of a retired section is refused and writes nothing", async () => {
    const scenario = setup("ignore:\n  - tests/**\n");
    const result = await policy(scenario, "--add-section", "uses");

    expect(result.exit).toBe(2);
    expect(result.err).toMatch(/^recognizer policy: uses: /);
    expect(scenario.read(POLICY)).toBe("ignore:\n  - tests/**\n");
  });

  it("--remove-section of the retired foreign section is refused and writes nothing", async () => {
    const scenario = setup();
    const result = await policy(scenario, "--remove-section", "foreign");

    expect(result.exit).toBe(2);
    expect(result.err).toMatch(/^recognizer policy: foreign: /);
    expect(scenario.read(POLICY)).toBe(BASE);
  });

  it("refuses a key typed as a section and a section typed as a key", async () => {
    const scenario = setup();
    const typedKey = await policy(scenario, "--add", "foreign", "x");

    expect(typedKey.exit).toBe(2);
    expect(typedKey.err).toMatch(/^recognizer policy: foreign: /);
    expect((await policy(scenario, "--add-section", "foreign.http")).exit).toBe(
      2,
    );
    expect(scenario.read(POLICY)).toBe(BASE);
  });
});

describe("recognizer policy refuses a write that introduces an error", () => {
  const refused: [string, string[]][] = [
    ["forbid", ["--add", "forbid", "no arrow"]],
    ["entry", ["--add", "entry", ""]],
  ];

  it.each(refused)(
    "%s: %j leaves the file byte-identical",
    async (key, argv) => {
      const scenario = setup();
      const result = await policy(scenario, ...argv);

      expect(result.exit).toBe(2);
      expect(result.err.startsWith(`recognizer policy: ${argv[1]}:`)).toBe(
        true,
      );
      expect(scenario.read(POLICY)).toBe(BASE);
      expect(key).toBe(argv[1]);
    },
  );

  it("saves a valid edit elsewhere in a file that already has an error", async () => {
    const broken = `${BASE}`.replace(
      "  - a/** -> b/**\n",
      "  - a/** -> b/**\n  - nope\n",
    );
    const scenario = setup(broken);

    expect((await policy(scenario, "--add", "ignore", "docs/**")).exit).toBe(0);
    expect(scenario.read(POLICY)).toBe(`${broken}  - docs/**\n`);
  });

  it("refuses an edit that adds a second error, naming only the new one", async () => {
    const broken = `${BASE}`.replace(
      "  - a/** -> b/**\n",
      "  - a/** -> b/**\n  - nope\n",
    );
    const scenario = setup(broken);
    const result = await policy(scenario, "--add", "forbid", "also bad");

    expect(result.exit).toBe(2);
    expect(result.err).toContain("also bad");
    expect(result.err).not.toContain("nope");
    expect(scenario.read(POLICY)).toBe(broken);
  });

  it("lets the one bad entry be unset while other errors remain", async () => {
    const broken = `${BASE}`.replace(
      "  - a/** -> b/**\n",
      "  - a/** -> b/**\n  - nope\n",
    );
    const scenario = setup(broken);

    expect((await policy(scenario, "--unset", "forbid", "nope")).exit).toBe(0);
    expect(scenario.read(POLICY)).not.toContain("nope");
  });
});

describe("recognizer policy --add-forbid", () => {
  const SRC_RULE = [
    "--add-forbid",
    "--from",
    "src/domain/**",
    "--from",
    "src/ports/**",
    "--to",
    "src/outer/**",
  ];

  it("appends a mapping rule and a repeat changes nothing", async () => {
    const scenario = setup(
      BASE.replace("foreign:\n  http:\n    - requests\n", ""),
    );

    expect((await policy(scenario, ...SRC_RULE)).exit).toBe(0);

    const after = scenario.read(POLICY);
    const listed = await policy(scenario, "--list");

    expect(after).toContain(
      "  - from: [src/domain/**, src/ports/**]\n    to: [src/outer/**]\n",
    );
    expect(
      listed.out.split("\n").filter((line) => line.startsWith("forbid=")),
    ).toHaveLength(2);
    expect((await policy(scenario, ...SRC_RULE)).exit).toBe(0);
    expect(scenario.read(POLICY)).toBe(after);
  });

  it("creates the policy on the first write", async () => {
    const scenario = setup(null);
    const result = await policy(
      scenario,
      "--add-forbid",
      "--from",
      "a/**",
      "--to",
      "b/**",
    );

    expect(result.exit).toBe(0);
    expect(scenario.read(POLICY)).toBe(
      "forbid:\n  - from: [a/**]\n    to: [b/**]\n",
    );
  });

  it("keeps the comments and layout of commented.yaml", async () => {
    const scenario = setup(fixture("commented.yaml"));
    const result = await policy(
      scenario,
      "--add-forbid",
      "--from",
      "shop/ui/**",
      "--to",
      "shop/db/**",
      "--to",
      "shop/cache/**",
    );

    expect(result.exit).toBe(0);
    expect(scenario.read(POLICY)).toBe(
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
  ])("%j is a usage error and writes nothing", async (argv) => {
    const scenario = setup();
    const result = await policy(scenario, ...argv);

    expect(result.exit).toBe(2);
    expect(result.err).toContain("usage: recognizer policy");
    expect(scenario.read(POLICY)).toBe(BASE);
  });

  it("refuses a write that would introduce an error", async () => {
    const scenario = setup();
    const result = await policy(
      scenario,
      "--add-forbid",
      "--from",
      " ",
      "--to",
      "b/**",
    );

    expect(result.exit).toBe(2);
    expect(scenario.read(POLICY)).toBe(BASE);
  });
});

describe("recognizer policy lists a list rule", () => {
  const WITH_RULE =
    "forbid:\n  - from: [a/**]\n    to: [b/**, c/**]\n  - x/** -> y/**\n";

  it("--list prints a mapping entry as forbid= followed by its JSON", async () => {
    const result = await policy(setup(WITH_RULE), "--list");

    expect(result.exit).toBe(0);
    expect(result.out).toBe(
      'forbid={"from":["a/**"],"to":["b/**","c/**"]}\nforbid=x/** -> y/**\n',
    );
  });

  it("--unset forbid <string rule> leaves a mapping entry in place", async () => {
    const scenario = setup(WITH_RULE);

    expect(
      (await policy(scenario, "--unset", "forbid", "x/** -> y/**")).exit,
    ).toBe(0);
    expect(scenario.read(POLICY)).toBe(
      "forbid:\n  - from: [a/**]\n    to: [b/**, c/**]\n",
    );
  });
});

describe("recognizer policy --unset forbid with a mapping rule", () => {
  const WITH_RULE =
    "forbid:\n  - from: [a/**]\n    to: [b/**, c/**]\n  - x/** -> y/**\n";

  it("removes the rule named as --list prints it", async () => {
    const scenario = setup(WITH_RULE);
    const result = await policy(
      scenario,
      "--unset",
      "forbid",
      'forbid={"from":["a/**"],"to":["b/**","c/**"]}',
    );

    expect(result.exit).toBe(0);
    expect(scenario.read(POLICY)).toBe("forbid:\n  - x/** -> y/**\n");
  });

  it("exits 1 and changes nothing when no rule matches", async () => {
    const scenario = setup(WITH_RULE);
    const result = await policy(
      scenario,
      "--unset",
      "forbid",
      'forbid={"from":["z/**"],"to":["b/**"]}',
    );

    expect(result.exit).toBe(1);
    expect(scenario.read(POLICY)).toBe(WITH_RULE);
  });
});

describe("recognizer policy keeps the file's text", () => {
  function lines(text: string): string[] {
    return text.split("\n");
  }

  it("keeps comments, blank lines, order, a scalar and a flow list through an add and an unset", async () => {
    const input = fixture("commented.yaml");
    const scenario = setup(input);

    expect(lines(input).filter((line) => line.includes("#")).length).toBe(3);
    expect(
      (await policy(scenario, "--add", "forbid", "shop/ui/** -> shop/db/**"))
        .exit,
    ).toBe(0);

    const added = scenario.read(POLICY);

    expect(added).toBe(fixture("commented.added.yaml"));
    expect((await policy(scenario, "--unset", "ignore", "tests/**")).exit).toBe(
      0,
    );

    const unset = scenario.read(POLICY);

    expect(unset).toBe(fixture("commented.unset.yaml"));

    for (const line of lines(input).filter(
      (l) => !l.includes("ignore") && !l.includes("tests/**"),
    )) {
      expect(lines(unset)).toContain(line);
    }
  });

  it("keeps a four-space indent", async () => {
    const scenario = setup(fixture("four-space.yaml"));

    expect((await policy(scenario, "--add", "entry", "shop/x.py")).exit).toBe(
      0,
    );
    expect(scenario.read(POLICY)).toBe(fixture("four-space.added.yaml"));
  });

  it("refuses --add onto a scalar and converts it by unset then add", async () => {
    const scenario = setup("entry: shop/main.py\n");
    const refused = await policy(scenario, "--add", "entry", "x");
    const got = await policy(scenario, "--get", "entry");

    expect(refused.exit).toBe(2);
    expect(refused.err).toContain("entry is a scalar, not a list");
    expect(got.exit).toBe(0);
    expect(got.out).toBe("shop/main.py\n");
  });

  it("reports a path --list cannot address and exits 1", async () => {
    const result = await policy(
      setup("foreign:\n  a.b: [x]\n  c: [y]\n"),
      "--list",
    );

    expect(result.exit).toBe(1);
    expect(result.out).toBe("foreign.c=y\n");
    expect(result.err).toContain("cannot be addressed");
  });

  it("--add entry works on a policy with no entry", async () => {
    const scenario = setup("ignore:\n  - tests/**\n");

    expect((await policy(scenario, "--add", "entry", "src/main.ts")).exit).toBe(
      0,
    );
    expect(scenario.read(POLICY)).toBe(
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
  ])(
    "%s exits 1 saying there is no policy and creates nothing",
    async (...argv) => {
      const scenario = setup(null);
      const result = await policy(scenario, ...argv);

      expect(result.exit).toBe(1);
      expect(result.err).toBe(
        "recognizer policy: there is no policy at .recognizer/policy.yaml\n",
      );
      expect(scenario.exists(".recognizer")).toBe(false);
    },
  );

  it("the first write creates the folder and a file that parses", async () => {
    const scenario = setup(null);

    expect(scenario.exists(".recognizer")).toBe(false);

    const written = await policy(scenario, "--add", "entry", "src/main.ts");
    const entries = await policy(scenario, "--get", "entry");

    expect(written.exit).toBe(0);
    expect(scenario.exists(POLICY)).toBe(true);
    expect(entries.exit).toBe(0);
    expect(entries.out).toBe("src/main.ts\n");
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
  ])("%j is a usage error", async (argv) => {
    const result = await policy(setup(), ...argv);

    expect(result.exit).toBe(2);
    expect(result.err).toContain("usage: recognizer policy");
  });
});

describe("recognizer check over a policy built only through recognizer policy", () => {
  it("gives the same report as the committed fixture policy", async () => {
    const handWritten = readFileSync(
      join(REPO, "fixtures/check/.recognizer/policy.yaml"),
      "utf8",
    );
    const scan = readFileSync(join(REPO, "fixtures/check/scan.json"), "utf8");
    const expected = JSON.parse(
      readFileSync(join(REPO, "fixtures/check/expected.json"), "utf8"),
    );
    const scenario = setup(null);
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
      expect((await policy(scenario, ...step)).exit).toBe(0);
    }

    const written = scenario.read(POLICY);

    const report = async (policyText: string) => {
      const checker = checkScenario({
        policy: false,
        baseline: false,
        cache: false,
        files: { "scan.json": scan, "other-policy.yaml": policyText },
      });
      const result = await checker.run([
        "check",
        "--scan",
        `${checker.repository}/scan.json`,
        "--policy",
        `${checker.repository}/other-policy.yaml`,
      ]);

      return { code: result.exit, report: JSON.parse(result.out) };
    };

    const fromCommand = await report(written);
    const fromHand = await report(handWritten);

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
  ])("%j lists every key with its type and example", async (...argv) => {
    const result = await setup().run(argv);

    expect(result.exit).toBe(0);

    const out = result.out;

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
