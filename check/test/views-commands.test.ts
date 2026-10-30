import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { COMMANDS } from "../src/commands.js";
import { VIEW_FLAGS, VIEW_SUBCOMMANDS } from "../src/views-command.js";
import { REPO } from "./helpers.js";
import { type Fake, fakeIo, ROOT } from "./scan-helpers.js";

const COMMIT = "abc123";
const CACHE = `${ROOT}/.recognizer/cache/scan.python.json`;
const VIEWS = `${ROOT}/.recognizer/views`;
const fixture = JSON.parse(
  readFileSync(join(REPO, "fixtures/python/expected-scan.json"), "utf8"),
);

function repository(
  files: Record<string, string> = {},
  diff?: string,
  commit: string | null = COMMIT,
) {
  return fakeIo({
    commit: commit ?? undefined,
    diff,
    files: {
      [`${ROOT}/shop/a.py`]: "",
      [CACHE]: JSON.stringify({
        ...fixture,
        commit: COMMIT,
        modified: false,
        files: [],
      }),
      ...files,
    },
  });
}

function view(
  name: string,
  steps: unknown[] = [],
  commit: string | null = COMMIT,
) {
  return {
    [`${VIEWS}/${name}.json`]: `${JSON.stringify({ schema_version: 1, description: "p", commit, steps }, null, 2)}\n`,
  };
}

function noted(
  name: string,
  extra: Record<string, unknown>,
  steps: unknown[] = [],
  version = 2,
) {
  return {
    [`${VIEWS}/${name}.json`]: `${JSON.stringify({ schema_version: version, description: "p", commit: COMMIT, ...extra, steps }, null, 2)}\n`,
  };
}

function go(fake: Fake, ...argv: string[]) {
  const before = fake.out().length;
  const code = run(["views", ...argv, "--repository", ROOT], fake.io);

  return { code, out: fake.out().slice(before), err: fake.err() };
}

function saved(fake: Fake, name: string) {
  return JSON.parse(fake.files.get(`${VIEWS}/${name}.json`) as string);
}

function scans(fake: Fake): number {
  return fake.calls.filter((c) => c.command.startsWith("recognizer-scan"))
    .length;
}

describe("views new", () => {
  it("writes the file with the head commit and no steps", () => {
    const fake = repository();
    const { code, out } = go(fake, "new", "a", "--description", "Why");

    expect(code).toBe(0);
    expect(out).toBe("a: created; 0 steps, resolves to 0 modules\n");
    expect(saved(fake, "a")).toEqual({
      schema_version: 2,
      description: "Why",
      commit: COMMIT,
      steps: [],
    });
    expect(fake.files.get(`${VIEWS}/a.json`)?.endsWith("}\n")).toBe(true);
    expect(scans(fake)).toBe(0);
  });

  it("writes to a temp file then renames it over the target", () => {
    const fake = repository();

    go(fake, "new", "a", "--description", "Why");

    expect(fake.writes).toEqual([`${VIEWS}/a.json.tmp`]);
    expect(fake.renames).toEqual([
      { from: `${VIEWS}/a.json.tmp`, to: `${VIEWS}/a.json` },
    ]);
    expect(fake.files.has(`${VIEWS}/a.json.tmp`)).toBe(false);
  });

  it("writes a null commit outside git", () => {
    const fake = repository({}, undefined, null);

    go(fake, "new", "a", "--description", "Why");

    expect(saved(fake, "a").commit).toBeNull();
  });

  it("prints json", () => {
    const { out } = go(
      repository(),
      "new",
      "a",
      "--description",
      "Why",
      "--json",
    );

    expect(JSON.parse(out)).toEqual({
      view: "a",
      changed: true,
      steps: 0,
      modules: 0,
    });
  });

  it("refuses an existing name, a blank description, a missing description and a bad name", () => {
    const fake = repository(view("a"));

    expect(go(fake, "new", "a", "--description", "x").code).toBe(2);
    expect(go(fake, "new", "b", "--description", "  ").code).toBe(2);
    expect(go(fake, "new", "b").code).toBe(2);
    expect(go(fake, "new", "../x", "--description", "x").code).toBe(2);
    expect(fake.writes).toEqual([]);
  });
});

describe("views add", () => {
  it("picks two modules", () => {
    const fake = repository(view("a"));
    const { code, out } = go(
      fake,
      "add",
      "a",
      "shop/domain/order.py",
      "shop/ports/store.py",
    );

    expect(code).toBe(0);
    expect(out).toBe("a: added 2 picks; 2 steps, resolves to 2 modules\n");
    expect(saved(fake, "a").steps).toEqual([
      { kind: "pick", module: "shop/domain/order.py" },
      { kind: "pick", module: "shop/ports/store.py" },
    ]);
    expect(scans(fake)).toBe(0);
  });

  it("writes nothing and names the unknown module", () => {
    const fake = repository(view("a"));
    const { code, err } = go(
      fake,
      "add",
      "a",
      "shop/domain/order.py",
      "nope.py",
    );

    expect(code).toBe(2);
    expect(err).toBe("no such module: nope.py\n");
    expect(fake.writes).toEqual([]);
  });

  it("is a no-op the second time", () => {
    const fake = repository(
      view("a", [{ kind: "pick", module: "shop/domain/order.py" }]),
    );
    const { code, out } = go(
      fake,
      "add",
      "a",
      "shop/domain/order.py",
      "--json",
    );

    expect(code).toBe(0);
    expect(JSON.parse(out)).toMatchObject({ changed: false, steps: 1 });
    expect(fake.writes).toEqual([]);
  });

  it("drops a left-out for the module", () => {
    const fake = repository(
      view("a", [
        { kind: "rule", relation: "folder", of: "shop/domain" },
        { kind: "left-out", module: "shop/domain/order.py" },
      ]),
    );

    go(fake, "add", "a", "shop/domain/order.py");

    expect(saved(fake, "a").steps).toEqual([
      { kind: "rule", relation: "folder", of: "shop/domain" },
      { kind: "pick", module: "shop/domain/order.py" },
    ]);
  });

  it("rejects an unknown view", () => {
    expect(go(repository(), "add", "a", "shop/domain/order.py").code).toBe(2);
  });
});

describe("views rule", () => {
  it.each([
    [
      ["--folder", "shop/domain/"],
      { kind: "rule", relation: "folder", of: "shop/domain" },
    ],
    [
      ["--uses", "shop/application/place.py"],
      { kind: "rule", relation: "uses", of: "shop/application/place.py" },
    ],
    [
      ["--used-by", "shop/ports/store.py"],
      { kind: "rule", relation: "used-by", of: "shop/ports/store.py" },
    ],
    [
      ["--used-by", "shop/ports/store.py", "--within", "shop/adapters"],
      {
        kind: "rule",
        relation: "used-by",
        of: "shop/ports/store.py",
        within: "shop/adapters",
      },
    ],
  ])("appends %j", (flags, step) => {
    const fake = repository(view("a"));
    const { code } = go(fake, "rule", "a", ...flags);

    expect(code).toBe(0);
    expect(saved(fake, "a").steps).toEqual([step]);
  });

  it("rejects --within with --folder, no relation, two relations and a missing anchor", () => {
    const fake = repository(view("a"));

    expect(
      go(fake, "rule", "a", "--folder", "shop", "--within", "shop").code,
    ).toBe(2);
    expect(go(fake, "rule", "a").code).toBe(2);
    expect(
      go(
        fake,
        "rule",
        "a",
        "--folder",
        "shop",
        "--uses",
        "shop/domain/order.py",
      ).code,
    ).toBe(2);
    expect(go(fake, "rule", "a", "--uses", "nope.py").code).toBe(2);
    expect(go(fake, "rule", "a", "--folder", "nowhere").code).toBe(2);
    expect(
      go(
        fake,
        "rule",
        "a",
        "--uses",
        "shop/domain/order.py",
        "--within",
        "nowhere",
      ).code,
    ).toBe(2);
    expect(fake.writes).toEqual([]);
  });

  it("rejects a flag that belongs to another subcommand", () => {
    expect(
      go(repository(view("a")), "add", "a", "shop/domain/order.py", "--fix")
        .code,
    ).toBe(2);
  });
});

describe("views fold and focus", () => {
  it("appends a fold and rejects a missing folder", () => {
    const fake = repository(view("a"));

    expect(go(fake, "fold", "a", "shop/adapters/").code).toBe(0);
    expect(saved(fake, "a").steps).toEqual([
      { kind: "fold", folder: "shop/adapters" },
    ]);
    expect(go(fake, "fold", "a", "nowhere").code).toBe(2);
  });

  it("keeps one focus step", () => {
    const fake = repository(view("a"));

    go(fake, "focus", "a", "shop/domain");
    go(fake, "focus", "a", "shop/ports");

    expect(saved(fake, "a").steps).toEqual([
      { kind: "focus", folder: "shop/ports" },
    ]);
  });
});

describe("views remove", () => {
  it("deletes a pick", () => {
    const fake = repository(
      view("a", [
        { kind: "pick", module: "shop/domain/order.py" },
        { kind: "pick", module: "shop/ports/store.py" },
      ]),
    );
    const { code, out } = go(fake, "remove", "a", "shop/domain/order.py");

    expect(code).toBe(0);
    expect(out).toContain("1 step, resolves to 1 module");
    expect(saved(fake, "a").steps).toEqual([
      { kind: "pick", module: "shop/ports/store.py" },
    ]);
  });

  it("records a module a rule put there as left out, and add undoes it", () => {
    const fake = repository(
      view("a", [{ kind: "rule", relation: "folder", of: "shop/domain" }]),
    );

    go(fake, "remove", "a", "shop/domain/order.py");

    expect(saved(fake, "a").steps).toEqual([
      { kind: "rule", relation: "folder", of: "shop/domain" },
      { kind: "left-out", module: "shop/domain/order.py" },
    ]);

    go(fake, "add", "a", "shop/domain/order.py");

    expect(saved(fake, "a").steps).toEqual([
      { kind: "rule", relation: "folder", of: "shop/domain" },
      { kind: "pick", module: "shop/domain/order.py" },
    ]);
  });

  it("rejects a module that is not on the view", () => {
    const fake = repository(view("a"));
    const { code, err } = go(fake, "remove", "a", "shop/domain/order.py");

    expect(code).toBe(2);
    expect(err).toBe("shop/domain/order.py is not on the view\n");
  });

  it("deletes a fold, a focus and a rule", () => {
    const fake = repository(
      view("a", [
        { kind: "fold", folder: "shop/adapters" },
        { kind: "focus", folder: "shop/domain" },
        {
          kind: "rule",
          relation: "used-by",
          of: "shop/ports/store.py",
          within: "shop/adapters",
        },
        { kind: "rule", relation: "used-by", of: "shop/ports/store.py" },
      ]),
    );

    expect(go(fake, "remove", "a", "shop/adapters", "--fold").code).toBe(0);
    expect(go(fake, "remove", "a", "shop/domain", "--focus").code).toBe(0);
    expect(
      go(
        fake,
        "remove",
        "a",
        "shop/ports/store.py",
        "--rule",
        "used-by",
        "--within",
        "shop/adapters",
      ).code,
    ).toBe(0);
    expect(saved(fake, "a").steps).toEqual([
      { kind: "rule", relation: "used-by", of: "shop/ports/store.py" },
    ]);
    expect(
      go(fake, "remove", "a", "shop/ports/store.py", "--rule", "uses").code,
    ).toBe(2);
    expect(go(fake, "remove", "a", "shop/adapters", "--fold").code).toBe(2);
  });
});

describe("views show", () => {
  const steps = [
    { kind: "pick", module: "shop/domain/gone.py" },
    { kind: "pick", module: "shop/domain/order.py" },
    { kind: "fold", folder: "shop/domain" },
  ];

  it("prints steps, modules and unresolved with exit 0", () => {
    const { code, out } = go(repository(view("a", steps)), "show", "a");

    expect(code).toBe(0);
    expect(out).toContain("a: p\nsaved at abc123\n");
    expect(out).toContain("  1. pick shop/domain/gone.py");
    expect(out).toContain("resolves to 1 module\n  shop/domain/order.py");
    expect(out).toContain("  step 1 pick shop/domain/gone.py - no such module");
    expect(out).toContain("folded: shop/domain");
  });

  it("prints json", () => {
    const document = JSON.parse(
      go(repository(view("a", steps)), "show", "a", "--json").out,
    );

    expect(document.name).toBe("a");
    expect(document.resolved).toEqual({
      modules: ["shop/domain/order.py"],
      folded: ["shop/domain"],
      focus: null,
    });
    expect(document.unresolved).toHaveLength(1);
  });

  it("rejects --current as an unknown flag", () => {
    const { code } = go(repository(), "show", "--current");

    expect(code).toBe(2);
    expect(go(repository(), "show", "--current", "--json").code).toBe(2);
  });
});

describe("views list", () => {
  it("is empty with no directory and runs no scan", () => {
    const fake = repository();

    expect(go(fake, "list")).toMatchObject({ code: 0, out: "\n" });
    expect(JSON.parse(go(fake, "list", "--json").out)).toEqual({ views: [] });
    expect(scans(fake)).toBe(0);
  });

  it("lists two views and one invalid file", () => {
    const fake = repository({
      ...view("b", [{ kind: "fold", folder: "x" }]),
      ...view("a"),
      [`${VIEWS}/c.json`]: "{}",
    });
    const { out } = go(fake, "list");
    const lines = out.trimEnd().split("\n");

    expect(lines[0]).toBe("a  0 steps  abc123  p");
    expect(lines[1]).toBe("b  1 step  abc123  p");
    expect(lines[2]).toMatch(/^c {2}invalid: /);

    const document = JSON.parse(go(fake, "list", "--json").out);

    expect(document.views[0]).toEqual({
      name: "a",
      description: "p",
      commit: COMMIT,
      steps: 0,
    });
    expect(document.views[2].error).toBeTruthy();
  });
});

describe("views check", () => {
  it("runs no scan when there is no views directory", () => {
    const fake = repository();

    expect(go(fake, "check").code).toBe(0);
    expect(scans(fake)).toBe(0);
    expect(fake.calls.filter((c) => c.args.includes("status"))).toEqual([]);
  });

  it("exits 0 for a clean view", () => {
    const fake = repository(
      view("a", [{ kind: "pick", module: "shop/domain/order.py" }]),
    );
    const { code, out } = go(fake, "check");

    expect(code).toBe(0);
    expect(out).toBe("a: ok\n");
  });

  it("exits 1 and names the step for a missing pick", () => {
    const { code, out } = go(
      repository(view("a", [{ kind: "pick", module: "shop/old.py" }])),
      "check",
    );

    expect(code).toBe(1);
    expect(out).toBe(
      "a: 1 unresolved\n  step 1 pick shop/old.py - no such module\n",
    );
  });

  it("exits 1 for an invalid file", () => {
    const { code, out } = go(
      repository({ [`${VIEWS}/a.json`]: "{}" }),
      "check",
    );

    expect(code).toBe(1);
    expect(out).toContain("a: invalid - ");
  });

  it("exits 2 for an unknown name", () => {
    expect(go(repository(view("a")), "check", "b").code).toBe(2);
    expect(go(repository(), "check", "b").code).toBe(2);
  });
});

describe("views check --fix", () => {
  const OLD = "shop/old.py";
  const NEW = "shop/domain/order.py";
  const renamed = `R100\0${OLD}\0${NEW}\0`;
  const diffArgs = (fake: Fake) =>
    fake.calls.filter((c) => c.args.includes("diff")).map((c) => c.args);

  it("rewrites a renamed pick and reports it", () => {
    const fake = repository(
      view("a", [{ kind: "pick", module: OLD }]),
      renamed,
    );
    const text = go(fake, "check");

    expect(text.code).toBe(1);
    expect(text.out).toContain(`(renamed to ${NEW})`);

    const { code, out } = go(fake, "check", "--fix", "--json");
    const document = JSON.parse(out);

    expect(code).toBe(0);
    expect(document.ok).toBe(true);
    expect(document.views[0].fixed).toEqual([{ step: 1, from: OLD, to: NEW }]);
    expect(saved(fake, "a").steps).toEqual([{ kind: "pick", module: NEW }]);
    expect(saved(fake, "a").commit).toBe(COMMIT);
    expect(diffArgs(fake)[0]).toEqual([
      "-C",
      ROOT,
      "diff",
      "-M",
      "--relative",
      "--name-status",
      "--diff-filter=R",
      "-z",
      COMMIT,
    ]);
  });

  it("drops the old pick when the new path is already picked", () => {
    const fake = repository(
      view("a", [
        { kind: "pick", module: OLD },
        { kind: "pick", module: NEW },
      ]),
      renamed,
    );

    expect(go(fake, "check", "--fix").code).toBe(0);
    expect(saved(fake, "a").steps).toEqual([{ kind: "pick", module: NEW }]);
  });

  it("does not fix a rename to a path outside the scan", () => {
    const fake = repository(
      view("a", [{ kind: "pick", module: OLD }]),
      `R100\0${OLD}\0shop/nowhere.py\0`,
    );
    const { code, out } = go(fake, "check", "--fix");

    expect(code).toBe(1);
    expect(out).not.toContain("renamed to");
    expect(saved(fake, "a").steps).toEqual([{ kind: "pick", module: OLD }]);
  });

  it("makes no git diff call for a view with no commit", () => {
    const fake = repository(
      view("a", [{ kind: "pick", module: OLD }], null),
      renamed,
    );

    expect(go(fake, "check", "--fix").code).toBe(1);
    expect(diffArgs(fake)).toEqual([]);
  });

  it("never fixes a step other than a pick", () => {
    const fake = repository(
      view("a", [{ kind: "rule", relation: "uses", of: OLD }]),
      renamed,
    );

    expect(go(fake, "check", "--fix").code).toBe(1);
  });
});

describe("views rm", () => {
  it("deletes the file and rejects an unknown view", () => {
    const fake = repository(view("a"));

    expect(go(fake, "rm", "a").code).toBe(0);
    expect(fake.removed).toEqual([`${VIEWS}/a.json`]);
    expect(go(fake, "rm", "a").code).toBe(2);
    expect(scans(fake)).toBe(0);
  });

  it("deletes a file that fails validation", () => {
    const fake = repository({ [`${VIEWS}/bad.json`]: "{}" });

    expect(go(fake, "rm", "bad").code).toBe(0);
    expect(fake.removed).toEqual([`${VIEWS}/bad.json`]);
  });
});

describe("the commit in the file", () => {
  it("is unchanged by every subcommand but new", () => {
    const fake = repository(
      view("a", [{ kind: "pick", module: "shop/old.py" }], "keep"),
      `R100\0shop/old.py\0shop/domain/order.py\0`,
    );

    for (const argv of [
      ["add", "a", "shop/ports/store.py"],
      ["rule", "a", "--folder", "shop/domain"],
      ["fold", "a", "shop/domain"],
      ["focus", "a", "shop/domain"],
      ["remove", "a", "shop/ports/store.py"],
      ["check", "--fix"],
    ]) {
      go(fake, ...argv);
      expect(saved(fake, "a").commit).toBe("keep");
    }
  });
});

const PLACE = "shop/domain/order.py";
const STORE = "shop/ports/store.py";
const ON_VIEW = [
  { kind: "pick", module: PLACE },
  { kind: "pick", module: STORE },
];

describe("views note", () => {
  it("sets a note on the view with the default author", () => {
    const fake = repository(view("a", ON_VIEW));
    const { code, out } = go(fake, "note", "a", "Start here");

    expect(code).toBe(0);
    expect(out).toBe("a: set the note; 2 steps, resolves to 2 modules\n");
    expect(saved(fake, "a").note).toEqual({ text: "Start here", by: "agent" });
    expect(saved(fake, "a").schema_version).toBe(2);
  });

  it("sets a note on a module with an explicit author and replaces it", () => {
    const fake = repository(view("a", ON_VIEW));

    expect(go(fake, "note", "a", PLACE, "One", "--by", "Ken").out).toContain(
      `set the note on ${PLACE}`,
    );
    expect(saved(fake, "a").module_notes).toEqual({
      [PLACE]: { text: "One", by: "Ken" },
    });

    const replaced = go(fake, "note", "a", PLACE, "Two", "--by", "Claude");

    expect(replaced.out).toContain(`replaced the note on ${PLACE}`);
    expect(saved(fake, "a").module_notes[PLACE]).toEqual({
      text: "Two",
      by: "Claude",
    });
  });

  it("replaces the view note", () => {
    const fake = repository(
      noted("a", { note: { text: "Old", by: "Ken" } }, ON_VIEW),
    );

    expect(go(fake, "note", "a", "New").out).toContain("replaced the note;");
    expect(saved(fake, "a").note).toEqual({ text: "New", by: "agent" });
  });

  it("reports no change and writes nothing for the same note", () => {
    const fake = repository(
      noted("a", { note: { text: "Same", by: "Ken" } }, ON_VIEW),
    );
    const { code, out } = go(
      fake,
      "note",
      "a",
      "Same",
      "--by",
      "Ken",
      "--json",
    );

    expect(code).toBe(0);
    expect(JSON.parse(out).changed).toBe(false);
    expect(fake.writes).toEqual([]);
  });

  it("removes each kind of note", () => {
    const fake = repository(
      noted(
        "a",
        {
          note: { text: "V", by: "Ken" },
          module_notes: { [PLACE]: { text: "M", by: "Ken" } },
        },
        ON_VIEW,
      ),
    );

    expect(go(fake, "note", "a", PLACE, "--remove").out).toContain(
      `removed the note on ${PLACE}`,
    );
    expect(saved(fake, "a").module_notes).toBeUndefined();
    expect(go(fake, "note", "a", "--remove").out).toContain(
      "removed the note;",
    );
    expect(saved(fake, "a").note).toBeUndefined();
  });

  it("is exit 2 for an absent note, a module not on the view, blank input and --remove with --by", () => {
    const fake = repository(view("a", ON_VIEW));

    expect(go(fake, "note", "a", "--remove").code).toBe(2);
    expect(go(fake, "note", "a", PLACE, "--remove").code).toBe(2);
    expect(go(fake, "note", "a", "shop/domain/other.py", "x").code).toBe(2);
    expect(go(fake, "note", "a", "   ").code).toBe(2);
    expect(go(fake, "note", "a", "x", "--by", " ").code).toBe(2);
    expect(go(fake, "note", "a", "--remove", "--by", "Ken").code).toBe(2);
    expect(go(fake, "show", "a", "--by", "Ken").code).toBe(2);
    expect(fake.writes).toEqual([]);
  });

  it("names the module that is not on the view", () => {
    const fake = repository(view("a", ON_VIEW));
    const { code } = go(fake, "note", "a", "shop/domain/other.py", "x");

    expect(code).toBe(2);
    expect(fake.err()).toContain("shop/domain/other.py is not on the view");
  });

  it("is shown by show in text and json, marking a module that left the scan", () => {
    const fake = repository(
      noted(
        "a",
        {
          note: { text: "V", by: "Ken" },
          module_notes: {
            [PLACE]: { text: "Here", by: "Ken" },
            "shop/gone.py": { text: "Lost", by: "Claude" },
          },
        },
        ON_VIEW,
      ),
    );
    const text = go(fake, "show", "a").out;

    expect(text).toContain("note: V (Ken)");
    expect(text).toContain(`  ${PLACE}: Here (Ken)\n`);
    expect(text).toContain("  shop/gone.py: Lost (Claude) (not on the view)");

    const document = JSON.parse(go(fake, "show", "a", "--json").out);

    expect(document.note).toEqual({ text: "V", by: "Ken" });
    expect(Object.keys(document.module_notes)).toHaveLength(2);
    expect(
      JSON.parse(go(repository(view("b")), "show", "b", "--json").out),
    ).toMatchObject({ note: null, module_notes: {} });
  });

  it("is kept by every other mutation, and by taking a module off the view", () => {
    const extra = {
      note: { text: "V", by: "Ken" },
      module_notes: { [PLACE]: { text: "M", by: "Ken" } },
    };
    const fake = repository(noted("a", extra, ON_VIEW));

    for (const argv of [
      ["add", "a", "shop/domain/aliases.py"],
      ["rule", "a", "--folder", "shop/domain"],
      ["fold", "a", "shop/domain"],
      ["focus", "a", "shop/domain"],
      ["remove", "a", PLACE],
    ]) {
      expect(go(fake, ...argv).code).toBe(0);
      expect(saved(fake, "a")).toMatchObject(extra);
    }
  });

  it("writes a version 1 view back at version 2 and leaves it alone on a no-op", () => {
    const fake = repository(noted("a", {}, ON_VIEW, 1));

    expect(go(fake, "note", "a", "--remove").code).toBe(2);
    expect(fake.writes).toEqual([]);
    expect(saved(fake, "a").schema_version).toBe(1);

    go(fake, "note", "a", "Hi");

    expect(saved(fake, "a").schema_version).toBe(2);
  });

  it("writes keys in order with module notes sorted", () => {
    const fake = repository(view("a", ON_VIEW));

    go(fake, "note", "a", STORE, "S");
    go(fake, "note", "a", PLACE, "P");
    go(fake, "note", "a", "V");

    expect(Object.keys(saved(fake, "a"))).toEqual([
      "schema_version",
      "description",
      "commit",
      "note",
      "module_notes",
      "steps",
    ]);
    expect(Object.keys(saved(fake, "a").module_notes)).toEqual([PLACE, STORE]);
  });

  it("moves a module note with a renamed pick and leaves an existing target note", () => {
    const OLD = "shop/old.py";
    const renamed = `R100\0${OLD}\0${PLACE}\0`;
    const moving = repository(
      noted("a", { module_notes: { [OLD]: { text: "M", by: "Ken" } } }, [
        { kind: "pick", module: OLD },
      ]),
      renamed,
    );

    go(moving, "check", "--fix");

    expect(saved(moving, "a").module_notes).toEqual({
      [PLACE]: { text: "M", by: "Ken" },
    });

    const kept = repository(
      noted(
        "a",
        {
          module_notes: {
            [OLD]: { text: "Old", by: "Ken" },
            [PLACE]: { text: "Own", by: "Claude" },
          },
        },
        [{ kind: "pick", module: OLD }],
      ),
      renamed,
    );

    go(kept, "check", "--fix");

    expect(saved(kept, "a").module_notes).toEqual({
      [OLD]: { text: "Old", by: "Ken" },
      [PLACE]: { text: "Own", by: "Claude" },
    });
  });
});

describe("views usage", () => {
  it("is exit 2 with no or an unknown subcommand", () => {
    const fake = repository();

    expect(run(["views"], fake.io)).toBe(2);
    expect(run(["views", "nope"], fake.io)).toBe(2);
  });
});

describe("views help", () => {
  const entry = COMMANDS.find(
    (c) => c.name === "views",
  ) as (typeof COMMANDS)[number];
  const text = JSON.stringify(entry);

  it("names every subcommand and every flag the parser reads", () => {
    for (const subcommand of VIEW_SUBCOMMANDS) {
      expect(entry.usage).toContain(`recognizer views ${subcommand}`);
      expect(entry.summary).toContain(subcommand);
    }

    for (const flag of VIEW_FLAGS) {
      expect(text).toContain(flag);
    }
  });

  it("is named by the short help", () => {
    const fake = fakeIo();

    run(["--help"], fake.io);

    expect(fake.out()).toContain("saved views");
  });
});

function words(command: string): string[] {
  return [...command.matchAll(/"([^"]*)"|(\S+)/g)].map(
    (m) => m[1] ?? (m[2] as string),
  );
}

describe("the help examples", () => {
  it("build the view the acceptance question asks for", () => {
    const acceptance = JSON.parse(
      readFileSync(join(REPO, "fixtures/python/views-acceptance.json"), "utf8"),
    );
    const entry = COMMANDS.find(
      (c) => c.name === "views",
    ) as (typeof COMMANDS)[number];
    const fake = repository();
    let last = "";

    for (const example of entry.examples) {
      const [program, ...argv] = words(example.command);

      expect(program).toBe("recognizer");
      expect(argv).not.toContain("--repository");

      const before = fake.out().length;

      expect(run([...argv, "--repository", ROOT], fake.io)).toBe(0);
      last = fake.out().slice(before);
    }

    expect(JSON.parse(last).resolved.modules).toEqual(acceptance.expected);
    expect(JSON.parse(last).unresolved).toEqual([]);
  });
});
