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
      schema_version: 4,
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
    expect(lines[2]).toBe("  stale: step 1 x no longer resolves");
    expect(lines[3]).toMatch(/^c {2}invalid: /);

    const document = JSON.parse(go(fake, "list", "--json").out);

    expect(document.views[0]).toEqual({
      name: "a",
      description: "p",
      commit: COMMIT,
      steps: 0,
      stale: [],
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

function noteEntry(module: string, text: string, by: string) {
  return { module, text, by };
}

describe("views note", () => {
  it("sets a note with the default author at version 3", () => {
    const fake = repository(view("a", ON_VIEW));
    const { code, out } = go(fake, "note", "a", PLACE, "Start here");

    expect(code).toBe(0);
    expect(out).toBe(
      `a: set the note on ${PLACE}; 2 steps, resolves to 2 modules\n`,
    );
    expect(saved(fake, "a").notes).toEqual([
      noteEntry(PLACE, "Start here", "agent"),
    ]);
    expect(saved(fake, "a").schema_version).toBe(4);
  });

  it("replaces the note on the same module, leaving one", () => {
    const fake = repository(view("a", ON_VIEW));

    go(fake, "note", "a", PLACE, "One", "--by", "Ken");
    go(fake, "note", "a", PLACE, "Two", "--by", "Claude");

    expect(saved(fake, "a").notes).toEqual([noteEntry(PLACE, "Two", "Claude")]);
  });

  it("sets a note on a folder that has a module on the view and refuses one that has none", () => {
    const fake = repository(view("a", ON_VIEW));

    expect(go(fake, "note", "a", "shop/domain/", "Core").code).toBe(0);
    expect(saved(fake, "a").notes).toEqual([
      noteEntry("shop/domain/", "Core", "agent"),
    ]);
    expect(go(fake, "note", "a", "nowhere/", "x").code).toBe(2);
    expect(fake.err()).toContain("nowhere/ has no module on the view");
  });

  it("reports no change and writes nothing for an identical note", () => {
    const fake = repository(
      noted("a", { notes: [noteEntry(PLACE, "Same", "Ken")] }, ON_VIEW, 3),
    );
    const { code, out } = go(
      fake,
      "note",
      "a",
      PLACE,
      "Same",
      "--by",
      "Ken",
      "--json",
    );

    expect(code).toBe(0);
    expect(JSON.parse(out).changed).toBe(false);
    expect(fake.writes).toEqual([]);
  });

  it("removes the note on a module or a folder and keeps the others", () => {
    const fake = repository(
      noted(
        "a",
        {
          notes: [
            noteEntry(PLACE, "A", "Ken"),
            noteEntry(STORE, "B", "Ken"),
            noteEntry("shop/domain/", "C", "Claude"),
          ],
        },
        ON_VIEW,
        3,
      ),
    );

    expect(go(fake, "note", "a", PLACE, "--remove").out).toContain(
      `removed the note on ${PLACE}`,
    );
    expect(go(fake, "note", "a", "shop/domain/", "--remove").code).toBe(0);
    expect(saved(fake, "a").notes).toEqual([noteEntry(STORE, "B", "Ken")]);

    expect(go(fake, "note", "a", STORE, "--remove").out).toContain(
      `removed the note on ${STORE}`,
    );
    expect(saved(fake, "a").notes).toBeUndefined();
  });

  it("removes with --by only when that author wrote the note last", () => {
    const fake = repository(
      noted("a", { notes: [noteEntry(PLACE, "C", "Claude")] }, ON_VIEW, 3),
    );
    const mismatch = go(fake, "note", "a", PLACE, "--remove", "--by", "Ken");

    expect(mismatch.code).toBe(2);
    expect(fake.err()).toContain(`the note on ${PLACE} is by Claude, not Ken`);
    expect(saved(fake, "a").notes).toEqual([noteEntry(PLACE, "C", "Claude")]);
    expect(
      go(fake, "note", "a", PLACE, "--remove", "--by", "Claude").code,
    ).toBe(0);
    expect(saved(fake, "a").notes).toBeUndefined();
  });

  it("removes a note on a module that has left the view", () => {
    const fake = repository(
      noted(
        "a",
        { notes: [noteEntry("shop/gone.py", "Lost", "Ken")] },
        ON_VIEW,
        3,
      ),
    );

    expect(go(fake, "note", "a", "shop/gone.py", "--remove").code).toBe(0);
    expect(saved(fake, "a").notes).toBeUndefined();
  });

  it("is exit 2 for an absent note, a module not on the view, blank input and the whole-view form", () => {
    const fake = repository(view("a", ON_VIEW));

    expect(go(fake, "note", "a", PLACE, "--remove").code).toBe(2);
    expect(fake.err()).toContain(`no note on ${PLACE}`);
    expect(go(fake, "note", "a", "shop/domain/other.py", "x").code).toBe(2);
    expect(go(fake, "note", "a", PLACE, "   ").code).toBe(2);
    expect(go(fake, "note", "a", PLACE, "x", "--by", " ").code).toBe(2);
    expect(go(fake, "note", "a", "Start here").code).toBe(2);
    expect(go(fake, "note", "a", "--remove").code).toBe(2);
    expect(go(fake, "show", "a", "--by", "Ken").code).toBe(2);
    expect(fake.writes).toEqual([]);
  });

  it("names the module that is not on the view", () => {
    const fake = repository(view("a", ON_VIEW));
    const { code } = go(fake, "note", "a", "shop/domain/other.py", "x");

    expect(code).toBe(2);
    expect(fake.err()).toContain("shop/domain/other.py is not on the view");
  });

  it("is shown by show in text and json, marking a module that left the scan and a folder with none on the view", () => {
    const fake = repository(
      noted(
        "a",
        {
          notes: [
            noteEntry(PLACE, "Here", "Ken"),
            noteEntry("shop/gone.py", "Lost", "Claude"),
            noteEntry("shop/domain/", "Folder", "Claude"),
            noteEntry("shop/missing/", "Empty", "Claude"),
          ],
        },
        ON_VIEW,
        3,
      ),
    );
    const text = go(fake, "show", "a").out;

    expect(text).not.toContain("note:");
    expect(text).toContain(`  1. ${PLACE}: Here (Ken)\n`);
    expect(text).toContain(
      "  2. shop/gone.py: Lost (Claude) (not on the view)",
    );
    expect(text).toContain("  3. shop/domain/: Folder (Claude)\n");
    expect(text).toContain(
      "  4. shop/missing/: Empty (Claude) (not on the view)",
    );
    expect(text.match(/\(not on the view\)/g)).toHaveLength(2);
    expect(text).not.toContain("warning:");

    const document = JSON.parse(go(fake, "show", "a", "--json").out);

    expect(document.notes).toHaveLength(4);
    expect(document.warnings).toEqual([]);
    expect(document.note).toBeUndefined();
    expect(document.module_notes).toBeUndefined();
    expect(
      JSON.parse(go(repository(view("b")), "show", "b", "--json").out),
    ).toMatchObject({ notes: [] });
  });

  it("shows the last of several notes on one path with one warning, and check prints it without failing", () => {
    const fake = repository(
      noted(
        "a",
        {
          notes: [
            noteEntry(PLACE, "First", "Ken"),
            noteEntry(PLACE, "Second", "Claude"),
          ],
        },
        ON_VIEW,
        3,
      ),
    );
    const text = go(fake, "show", "a").out;

    expect(text).toContain(`  1. ${PLACE}: Second (Claude)\n`);
    expect(text).not.toContain("First");
    expect(text).toContain(
      `warning: view holds 1 note on ${PLACE}; kept the last on each\n`,
    );

    const json = JSON.parse(go(fake, "show", "a", "--json").out);

    expect(json.notes).toEqual([
      { ...noteEntry(PLACE, "Second", "Claude"), number: 1 },
    ]);
    expect(json.warnings).toHaveLength(1);

    const checked = go(fake, "check");

    expect(checked.code).toBe(0);
    expect(checked.out).toContain("  warning: view holds 1 note on");
  });

  it("lists the committed legacy example's last note and its warning", () => {
    const legacy = readFileSync(
      join(REPO, "schema/view-examples/valid/version-3-with-notes.json"),
      "utf8",
    );
    const fake = repository({ [`${VIEWS}/legacy.json`]: legacy });
    const document = JSON.parse(go(fake, "show", "legacy", "--json").out);

    expect(document.notes).toEqual([
      {
        ...noteEntry("shop/application/place.py", expect.any(String), "Claude"),
        number: 1,
      },
    ]);
    expect(document.warnings).toEqual([
      "view holds 1 note on shop/application/place.py; kept the last on each",
    ]);
  });

  it("shows the module notes of a version 2 file before it is rewritten", () => {
    const fake = repository(
      noted(
        "a",
        { module_notes: { [PLACE]: { text: "M", by: "Ken" } } },
        ON_VIEW,
        2,
      ),
    );

    expect(JSON.parse(go(fake, "show", "a", "--json").out).notes).toEqual([
      { ...noteEntry(PLACE, "M", "Ken"), number: 1 },
    ]);
    expect(fake.writes).toEqual([]);
  });

  it("is kept by every other mutation, and by taking a module off the view", () => {
    const notes = [noteEntry(PLACE, "M", "Ken")];
    const fake = repository(noted("a", { notes }, ON_VIEW, 3));

    for (const argv of [
      ["add", "a", "shop/domain/aliases.py"],
      ["rule", "a", "--folder", "shop/domain"],
      ["fold", "a", "shop/domain"],
      ["focus", "a", "shop/domain"],
      ["remove", "a", PLACE],
    ]) {
      expect(go(fake, ...argv).code).toBe(0);
      expect(saved(fake, "a")).toMatchObject({ notes });
    }
  });

  it("writes a version 2 view with both note kinds back at version 3 without the view note", () => {
    const fake = repository(
      noted(
        "a",
        {
          note: { text: "V", by: "Ken" },
          module_notes: {
            [STORE]: { text: "S", by: "Claude" },
            [PLACE]: { text: "P", by: "Ken" },
          },
        },
        ON_VIEW,
        2,
      ),
    );

    expect(go(fake, "add", "a", "shop/domain/aliases.py").code).toBe(0);

    const written = saved(fake, "a");

    expect(written.schema_version).toBe(4);
    expect(written.note).toBeUndefined();
    expect(written.module_notes).toBeUndefined();
    expect(written.notes).toEqual([
      noteEntry(PLACE, "P", "Ken"),
      noteEntry(STORE, "S", "Claude"),
    ]);
  });

  it("writes a version 1 view back at version 3 and leaves it alone on a no-op", () => {
    const fake = repository(noted("a", {}, ON_VIEW, 1));

    expect(go(fake, "note", "a", PLACE, "--remove").code).toBe(2);
    expect(fake.writes).toEqual([]);
    expect(saved(fake, "a").schema_version).toBe(1);

    go(fake, "note", "a", PLACE, "Hi");

    expect(saved(fake, "a").schema_version).toBe(4);
  });

  it("writes keys in order with notes in the order they were added", () => {
    const fake = repository(view("a", ON_VIEW));

    go(fake, "note", "a", STORE, "S");
    go(fake, "note", "a", PLACE, "P");

    expect(Object.keys(saved(fake, "a"))).toEqual([
      "schema_version",
      "description",
      "commit",
      "notes",
      "steps",
    ]);
    expect(
      saved(fake, "a").notes.map((n: { module: string }) => n.module),
    ).toEqual([STORE, PLACE]);
  });

  it("rewrites a version 2 file to the same bytes the app serialiser writes", () => {
    const fake = repository(
      noted(
        "a",
        { module_notes: { [PLACE]: { text: "M", by: "Ken" } } },
        ON_VIEW,
        2,
      ),
    );

    go(fake, "note", "a", STORE, "S", "--by", "Claude");

    expect(fake.files.get(`${VIEWS}/a.json`)).toBe(
      `${JSON.stringify(
        {
          schema_version: 4,
          description: "p",
          commit: COMMIT,
          notes: [
            noteEntry(PLACE, "M", "Ken"),
            noteEntry(STORE, "S", "Claude"),
          ],
          steps: ON_VIEW,
        },
        null,
        2,
      )}\n`,
    );
  });

  it("renames the module on the notes of a renamed pick and keeps the last where two land on one path", () => {
    const OLD = "shop/old.py";
    const renamed = `R100\0${OLD}\0${PLACE}\0`;
    const moving = repository(
      noted(
        "a",
        {
          notes: [
            noteEntry(OLD, "One", "Ken"),
            noteEntry(STORE, "Other", "Ken"),
            noteEntry(OLD, "Two", "Claude"),
          ],
        },
        [{ kind: "pick", module: OLD }],
        3,
      ),
      renamed,
    );

    go(moving, "check", "--fix");

    expect(saved(moving, "a").notes).toEqual([
      noteEntry(STORE, "Other", "Ken"),
      noteEntry(PLACE, "Two", "Claude"),
    ]);
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

describe("views note ordering", () => {
  const three = () =>
    repository(
      noted(
        "a",
        {
          notes: [noteEntry(PLACE, "P", "Ken"), noteEntry(STORE, "S", "Ken")],
        },
        [...ON_VIEW, { kind: "pick", module: "shop/domain/aliases.py" }],
        4,
      ),
    );
  const order = (fake: Fake) =>
    (saved(fake, "a").notes as { module: string }[]).map((n) => n.module);

  it("puts a new note last and keeps an existing note in place", () => {
    const fake = three();

    go(fake, "note", "a", "shop/domain/aliases.py", "A");
    expect(order(fake)).toEqual([PLACE, STORE, "shop/domain/aliases.py"]);

    go(fake, "note", "a", PLACE, "P2");
    expect(order(fake)[0]).toBe(PLACE);
  });

  it("places with --after and --first and moves an existing note", () => {
    const fake = three();

    go(fake, "note", "a", "shop/domain/aliases.py", "A", "--after", PLACE);
    expect(order(fake)).toEqual([PLACE, "shop/domain/aliases.py", STORE]);

    go(fake, "note", "a", STORE, "S", "--first");
    expect(order(fake)[0]).toBe(STORE);
  });

  it("refuses --after with --first, either with --remove, and an unheld --after", () => {
    const fake = three();

    expect(
      go(fake, "note", "a", PLACE, "x", "--after", STORE, "--first").code,
    ).toBe(2);
    expect(go(fake, "note", "a", PLACE, "--remove", "--first").code).toBe(2);
    expect(
      go(fake, "note", "a", PLACE, "--remove", "--after", STORE).code,
    ).toBe(2);
    expect(go(fake, "note", "a", PLACE, "x", "--after", "nope.py").code).toBe(
      2,
    );
  });

  it("reorders with the exact set", () => {
    const fake = three();

    expect(go(fake, "reorder", "a", STORE, PLACE).code).toBe(0);
    expect(order(fake)).toEqual([STORE, PLACE]);
  });

  it("names a missing, an extra and a repeated path in one error", () => {
    const fake = three();
    const result = go(fake, "reorder", "a", STORE, STORE, "x.py");

    expect(result.code).toBe(2);
    expect(result.err).toContain(`${PLACE} is missing`);
    expect(result.err).toContain("no note on x.py");
    expect(result.err).toContain(`${STORE} is repeated`);
  });

  it("refuses reorder on a view with no notes", () => {
    const fake = repository(noted("a", {}, ON_VIEW, 4));
    const result = go(fake, "reorder", "a", PLACE);

    expect(result.code).toBe(2);
    expect(result.err).toContain("no notes to reorder");
  });

  it("refuses set without the flag and refuses the removed --ordered", () => {
    const fake = three();

    expect(go(fake, "set", "a").code).toBe(2);
    expect(go(fake, "set", "a", "--ordered", "false").code).toBe(2);
  });

  it("shows every note numbered in reading order", () => {
    const fake = three();

    expect(go(fake, "show", "a").out).toContain(
      `notes:\n  1. ${PLACE}: P (Ken)`,
    );
    expect(JSON.parse(go(fake, "show", "a", "--json").out)).toMatchObject({
      notes: [{ number: 1 }, { number: 2 }],
    });
    expect(JSON.parse(go(fake, "show", "a", "--json").out)).not.toHaveProperty(
      "ordered",
    );
  });
});

describe("change views", () => {
  const SHAS: Record<string, string> = {
    main: COMMIT,
    feat: "feed01",
    old: "0ld001",
  };

  function git(
    merged: string[] = [],
    diff = "A\0shop/adapters/memory_store.py\0D\0shop/gone.py\0",
  ) {
    return {
      git: (args: string[]) => {
        if (args.includes("--verify")) {
          const ref = (args.at(-1) as string).replace("^{commit}", "");
          const sha = SHAS[ref];

          return sha === undefined ? { status: 1 } : { stdout: `${sha}\n` };
        }

        if (args.includes("merge-base")) {
          return { status: merged.includes(args.at(-2) as string) ? 0 : 1 };
        }

        if (args.includes("--no-renames")) {
          return { stdout: diff };
        }

        if (args.includes("status") || args.includes("diff")) {
          return {};
        }

        return { stdout: `${COMMIT}\n` };
      },
    };
  }

  function repo(
    files: Record<string, string> = {},
    merged?: string[],
    diff?: string,
  ) {
    return fakeIo({
      programs: git(merged, diff),
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

  function changeView(name: string, change: unknown, steps: unknown[] = []) {
    return {
      [`${VIEWS}/${name}.json`]: `${JSON.stringify({ schema_version: 4, description: "p", commit: COMMIT, change, steps }, null, 2)}\n`,
    };
  }

  it("writes the range on new --change", () => {
    const fake = repo();
    const result = go(
      fake,
      "new",
      "c",
      "--description",
      "D",
      "--change",
      "main..feat",
    );

    expect(result.code).toBe(0);
    expect(saved(fake, "c").change).toEqual({ base: "main", head: "feat" });
  });

  it("refuses an unknown ref, naming it, and writes nothing", () => {
    const fake = repo();
    const result = go(
      fake,
      "new",
      "c",
      "--description",
      "D",
      "--change",
      "main..nope",
    );

    expect(result.code).toBe(1);
    expect(result.err).toContain("unknown ref: nope");
    expect(fake.files.has(`${VIEWS}/c.json`)).toBe(false);
  });

  it("never passes an option-shaped ref to git", () => {
    const fake = repo();
    const result = go(
      fake,
      "new",
      "c",
      "--description",
      "D",
      "--change",
      "main..--output=x",
    );

    expect(result.code).toBe(2);
    expect(
      fake.calls.some((call) =>
        call.args.some((arg) => arg.includes("--output")),
      ),
    ).toBe(false);
  });

  it("sets, replaces and removes the range", () => {
    const fake = repo(view("a"));

    go(fake, "set", "a", "--change", "main..feat");
    expect(saved(fake, "a").change).toEqual({ base: "main", head: "feat" });

    go(fake, "set", "a", "--change", "main..old");
    expect(saved(fake, "a").change.head).toBe("old");

    go(fake, "set", "a", "--change", "none");
    expect(saved(fake, "a")).not.toHaveProperty("change");
  });

  it("refuses set with none of --change, --title and --description", () => {
    const fake = repo(view("a"));

    expect(go(fake, "set", "a").code).toBe(2);
  });

  it("sets the description with set --description", () => {
    const fake = repo(view("a"));
    const result = go(fake, "set", "a", "--description", "Shows the flow");

    expect(result.code).toBe(0);
    expect(result.out).toContain("set the description");
    expect(saved(fake, "a").description).toBe("Shows the flow");
  });

  it("sets the trimmed title and removes it with an empty --title", () => {
    const fake = repo(view("a"));

    go(fake, "set", "a", "--title", "  Placing an order  ");
    expect(saved(fake, "a").title).toBe("Placing an order");

    const removed = go(fake, "set", "a", "--title", "");

    expect(removed.out).toContain("removed the title");
    expect(saved(fake, "a")).not.toHaveProperty("title");
  });

  it("refuses a blank --description on set", () => {
    const fake = repo(view("a"));
    const result = go(fake, "set", "a", "--description", "  ");

    expect(result.code).toBe(2);
    expect(result.err).toContain("--description");
  });

  it("writes title, description and range once when set gets all three", () => {
    const fake = repo(view("a"));
    const result = go(
      fake,
      "set",
      "a",
      "--title",
      "T",
      "--description",
      "D",
      "--change",
      "main..feat",
    );

    expect(result.code).toBe(0);
    expect(result.out).toContain(
      "set the title, set the description, set the range to",
    );
    expect(saved(fake, "a")).toMatchObject({
      title: "T",
      description: "D",
      change: { base: "main", head: "feat" },
    });
  });

  it("prints no change when set repeats the stored values", () => {
    const fake = repo(view("a"));

    go(fake, "set", "a", "--title", "T", "--description", "D");

    const again = go(fake, "set", "a", "--title", "T", "--description", "D");

    expect(again.code).toBe(0);
    expect(again.out).toContain("no change");
  });

  it("prints the marked modules and the unmatched count from diff", () => {
    const fake = repo(changeView("c", { base: "main", head: "feat" }));
    const result = go(fake, "diff", "c", "--json");
    const document = JSON.parse(result.out);

    expect(result.code).toBe(0);
    expect(document).toMatchObject({
      view: "c",
      range: "main..feat",
      baseCommit: COMMIT,
      headCommit: "feed01",
      unmatched: 0,
    });
    expect(document.modules).toEqual([
      {
        id: "shop/adapters/memory_store.py",
        mark: "added",
        box: "current",
      },
      { id: "shop/gone.py", mark: "removed", box: "none" },
    ]);
  });

  it("refuses diff for a view without a range and writes nothing", () => {
    const fake = repo(view("a"));
    const result = go(fake, "diff", "a");

    expect(result.code).toBe(1);
    expect(fake.writes).toEqual([]);
  });

  it("lists and checks a merged view and a head-gone view with exit 0", () => {
    const fake = repo(
      {
        ...changeView("merged", { base: "main", head: "old" }),
        ...changeView("gone", { base: "main", head: "ghost" }),
        ...changeView("live", { base: "main", head: "feat" }),
      },
      ["0ld001"],
    );
    const list = JSON.parse(go(fake, "list", "--json").out) as {
      views: { name: string; change?: unknown; stale: unknown[] }[];
    };
    const byName = Object.fromEntries(list.views.map((row) => [row.name, row]));

    expect(byName.live?.stale).toEqual([]);
    expect(byName.merged?.stale).toEqual([
      { kind: "merged", head: "old", base: "main" },
    ]);
    expect(byName.gone?.stale).toEqual([
      { kind: "head-missing", head: "ghost" },
    ]);
    expect(byName.live?.change).toEqual({ base: "main", head: "feat" });

    const text = go(fake, "list").out;

    expect(text).toContain("stale: head old is merged into main");

    const check = go(fake, "check");

    expect(check.code).toBe(0);
    expect(check.out).toContain("stale: head ghost is not in the repository");
    expect(
      JSON.parse(go(fake, "check", "--json").out).views[0].stale,
    ).toBeDefined();
  });
});

describe("plan views", () => {
  const NEW = "shop/application/discount.py";
  const ORDER = "shop/domain/order.py";
  const planned = (
    extra: Record<string, unknown> = {},
    steps: unknown[] = [],
  ) => noted("p", { plan: true, ...extra }, steps, 4);

  it("creates a plan and refuses a plan with a range", () => {
    const fake = repository();

    expect(go(fake, "new", "p", "--description", "d", "--plan").code).toBe(0);
    expect(saved(fake, "p")).toEqual({
      schema_version: 4,
      description: "d",
      commit: COMMIT,
      plan: true,
      steps: [],
    });

    const refused = go(
      fake,
      "new",
      "q",
      "--description",
      "d",
      "--plan",
      "--change",
      "a..b",
    );

    expect(refused.code).toBe(2);
    expect(fake.files.has(`${VIEWS}/q.json`)).toBe(false);
  });

  it("refuses set --plan on a change view and set --change on a plan", () => {
    const fake = repository(
      noted("c", { change: { base: "main", head: "feat" } }, [], 4),
    );

    expect(go(fake, "set", "c", "--plan").code).toBe(2);

    const plan = repository(planned());

    expect(go(plan, "set", "p", "--change", "main..feat").code).toBe(2);
  });

  it("makes a view a plan and set --no-plan drops the proposed changes", () => {
    const fake = repository(view("a"));

    expect(go(fake, "set", "a", "--plan").code).toBe(0);
    expect(saved(fake, "a").plan).toBe(true);

    go(fake, "add", "a", NEW, "--change", "new");

    const cleared = go(fake, "set", "a", "--no-plan");

    expect(cleared.code).toBe(0);
    expect(cleared.out).toContain("dropped 1 proposed change");
    expect(saved(fake, "a").plan).toBeUndefined();
    expect(saved(fake, "a").proposed).toBeUndefined();
  });

  it("adds a new module that is not in the scan with only a proposed change", () => {
    const fake = repository(planned());

    expect(go(fake, "add", "p", NEW, "--change", "new").code).toBe(0);
    expect(saved(fake, "p").steps).toEqual([]);
    expect(saved(fake, "p").proposed).toEqual([{ module: NEW, kind: "new" }]);
    expect(go(fake, "check").code).toBe(0);
  });

  it("gives a module in the scan a pick as well as its proposed change", () => {
    const fake = repository(planned());

    go(fake, "add", "p", ORDER, "--change", "changes");

    expect(saved(fake, "p").steps).toEqual([{ kind: "pick", module: ORDER }]);
    expect(saved(fake, "p").proposed).toEqual([
      { module: ORDER, kind: "changes" },
    ]);
  });

  it("refuses changes and removed for a module not in the scan", () => {
    const fake = repository(planned());
    const { code, err } = go(fake, "add", "p", NEW, "--change", "changes");

    expect(code).toBe(2);
    expect(err).toContain(`no such module: ${NEW}`);
    expect(go(fake, "add", "p", NEW, "--change", "removed").code).toBe(2);
  });

  it("enforces --from rules on add", () => {
    const fake = repository(planned());

    expect(go(fake, "add", "p", NEW, "--change", "moves").code).toBe(2);
    expect(
      go(fake, "add", "p", NEW, "--change", "moves", "--from", NEW).code,
    ).toBe(2);
    expect(
      go(fake, "add", "p", NEW, "--change", "new", "--from", "x/y.py").code,
    ).toBe(2);
    expect(
      go(
        fake,
        "add",
        "p",
        NEW,
        "shop/b.py",
        "--change",
        "moves",
        "--from",
        "x/y.py",
      ).code,
    ).toBe(2);
    expect(
      go(fake, "add", "p", NEW, "--change", "moves", "--from", "x/y.py").code,
    ).toBe(0);
    expect(saved(fake, "p").proposed).toEqual([
      { module: NEW, kind: "moves", from: "x/y.py" },
    ]);
  });

  it("refuses --change on a view that is not a plan and adds as today without it", () => {
    const fake = repository(view("a"));

    expect(go(fake, "add", "a", NEW, "--change", "new").code).toBe(2);
    expect(go(fake, "add", "a", NEW).code).toBe(2);
  });

  it("changes and clears a proposed change", () => {
    const fake = repository(
      planned({ proposed: [{ module: ORDER, kind: "changes" }] }, [
        { kind: "pick", module: ORDER },
      ]),
    );

    expect(go(fake, "change", "p", ORDER, "removed").code).toBe(0);
    expect(saved(fake, "p").proposed).toEqual([
      { module: ORDER, kind: "removed" },
    ]);
    expect(go(fake, "change", "p", ORDER, "--clear").code).toBe(0);
    expect(saved(fake, "p").proposed).toBeUndefined();
    expect(saved(fake, "p").steps).toEqual([{ kind: "pick", module: ORDER }]);
  });

  it("refuses to clear the proposed change of a planned module", () => {
    const fake = repository(
      planned({ proposed: [{ module: NEW, kind: "new" }] }),
    );
    const { code, err } = go(fake, "change", "p", NEW, "--clear");

    expect(code).toBe(2);
    expect(err).toContain(`${NEW} is planned; remove it with views remove`);
  });

  it("removes a planned module", () => {
    const fake = repository(
      planned({ proposed: [{ module: NEW, kind: "new" }] }),
    );

    expect(go(fake, "remove", "p", NEW).code).toBe(0);
    expect(saved(fake, "p").proposed).toBeUndefined();
  });

  it("drops the proposed change when an in-scan module is taken off", () => {
    const fake = repository(
      planned({ proposed: [{ module: ORDER, kind: "changes" }] }, [
        { kind: "pick", module: ORDER },
      ]),
    );

    go(fake, "remove", "p", ORDER);

    expect(saved(fake, "p").proposed).toBeUndefined();
    expect(saved(fake, "p").steps).toEqual([]);
  });

  it("takes a note on a planned module and on its folder", () => {
    const fake = repository(
      planned({ proposed: [{ module: NEW, kind: "new" }] }),
    );

    expect(go(fake, "note", "p", NEW, "Will price orders").code).toBe(0);
    expect(go(fake, "note", "p", "shop/application/", "The folder").code).toBe(
      0,
    );
    expect(
      saved(fake, "p").notes.map((n: { module: string }) => n.module),
    ).toEqual([NEW, "shop/application/"]);
    expect(go(fake, "show", "p").out).not.toContain("(not on the view)");
  });

  it("reads every proposed change back through show, text and json", () => {
    const fake = repository(
      planned(
        {
          proposed: [
            { module: NEW, kind: "new" },
            { module: "shop/x/m.py", kind: "moves", from: ORDER },
          ],
        },
        [],
      ),
    );
    const text = go(fake, "show", "p").out;

    expect(text.split("\n")[1]).toBe("plan");
    expect(text).toContain(`  new ${NEW} (planned)`);
    expect(text).toContain(`  moves shop/x/m.py (from ${ORDER}) (planned)`);

    const document = JSON.parse(go(fake, "show", "p", "--json").out);

    expect(document.plan).toBe(true);
    expect(document.proposed).toEqual([
      { module: NEW, kind: "new" },
      { module: "shop/x/m.py", kind: "moves", from: ORDER },
    ]);
    expect(document.resolved.planned).toEqual([NEW, "shop/x/m.py"]);
  });

  it("prints a view that is not a plan as before", () => {
    const fake = repository(view("a", [{ kind: "pick", module: ORDER }]));
    const document = JSON.parse(go(fake, "show", "a", "--json").out);

    expect(Object.keys(document)).not.toContain("plan");
    expect(Object.keys(document)).not.toContain("proposed");
    expect(Object.keys(document.resolved)).toEqual([
      "modules",
      "folded",
      "focus",
    ]);
    expect(go(fake, "show", "a").out).not.toContain("plan");
  });

  it("lists a plan with the plan word", () => {
    const fake = repository({ ...planned(), ...view("a") });
    const text = go(fake, "list").out;

    expect(text).toContain("p  plan  0 steps");
    expect(text).not.toContain("a  plan");
    expect(JSON.parse(go(fake, "list", "--json").out).views[1].plan).toBe(true);
    expect(
      JSON.parse(go(fake, "list", "--json").out).views[0].plan,
    ).toBeUndefined();
  });

  it("check --fix follows a rename into a proposed change", () => {
    const OLD = "shop/old.py";
    const fake = repository(
      planned(
        {
          proposed: [
            { module: OLD, kind: "changes" },
            { module: NEW, kind: "moves", from: OLD },
          ],
        },
        [{ kind: "pick", module: OLD }],
      ),
      `R100\0${OLD}\0${ORDER}\0`,
    );

    expect(go(fake, "check", "--fix").code).toBe(0);
    expect(saved(fake, "p").proposed).toEqual([
      { module: ORDER, kind: "changes" },
      { module: NEW, kind: "moves", from: ORDER },
    ]);
  });

  it("writes only under .recognizer/views", () => {
    const fake = repository(planned());

    go(fake, "add", "p", NEW, "--change", "new");

    expect(fake.writes.every((w) => w.startsWith(`${VIEWS}/`))).toBe(true);
  });
});

describe("member entries in a plan", () => {
  const ORDER = "shop/domain/order.py";
  const NEW = "shop/application/discount.py";
  const planned = (
    extra: Record<string, unknown> = {},
    steps: unknown[] = [],
  ) => noted("p", { plan: true, ...extra }, steps, 4);
  const pickOrder = [{ kind: "pick", module: ORDER }];

  it("adds a new member that is not in the scan and puts its module on the view", () => {
    const fake = repository(planned());
    const result = go(
      fake,
      "add",
      "p",
      `${ORDER}#Order.apply_discount`,
      "--change",
      "new",
    );

    expect(result.code).toBe(0);
    expect(saved(fake, "p").steps).toEqual(pickOrder);
    expect(saved(fake, "p").proposed).toEqual([
      { module: ORDER, member: "Order.apply_discount", kind: "new" },
    ]);
  });

  it("refuses changes on a member that is not in the scan and takes removed for one that is", () => {
    const fake = repository(planned());

    expect(
      go(fake, "add", "p", `${ORDER}#Order.gone`, "--change", "changes").code,
    ).not.toBe(0);
    expect(fake.err()).toContain(`no such member: ${ORDER}#Order.gone`);
    expect(
      go(fake, "add", "p", `${ORDER}#Order.total`, "--change", "removed").code,
    ).toBe(0);
    expect(saved(fake, "p").proposed).toEqual([
      { module: ORDER, member: "Order.total", kind: "removed" },
    ]);
  });

  it("refuses --from, moves, and a member on a module that is not in the scan", () => {
    const fake = repository(planned());

    expect(
      go(
        fake,
        "add",
        "p",
        `${ORDER}#Order.total`,
        "--change",
        "removed",
        "--from",
        "x.py",
      ).code,
    ).not.toBe(0);
    expect(
      go(fake, "add", "p", `${ORDER}#Order.total`, "--change", "moves").code,
    ).not.toBe(0);
    expect(fake.err()).toContain("a member takes new, changes or removed");
    expect(
      go(fake, "add", "p", "shop/none.py#f", "--change", "new").code,
    ).not.toBe(0);
    expect(fake.err()).toContain("no such module: shop/none.py");
  });

  it("refuses a member on a planned module and a wholly new module entry on a module holding members", () => {
    const fake = repository(
      planned(
        {
          proposed: [
            { module: NEW, kind: "new" },
            { module: ORDER, member: "Order.total", kind: "changes" },
          ],
        },
        pickOrder,
      ),
    );

    expect(
      go(fake, "add", "p", `${NEW}#Discount`, "--change", "new").code,
    ).not.toBe(0);
    expect(fake.err()).toContain(`${NEW} is wholly new; mark the module only`);
    expect(go(fake, "add", "p", ORDER, "--change", "new").code).not.toBe(0);
    expect(fake.err()).toContain(
      `${ORDER} is wholly new; mark the module only`,
    );
  });

  it("changes and clears a member entry", () => {
    const fake = repository(
      planned(
        {
          proposed: [{ module: ORDER, member: "Order.total", kind: "changes" }],
        },
        pickOrder,
      ),
    );

    expect(
      go(fake, "change", "p", `${ORDER}#Order.total`, "removed").code,
    ).toBe(0);
    expect(saved(fake, "p").proposed[0].kind).toBe("removed");
    expect(
      go(fake, "change", "p", `${ORDER}#Order.total`, "--clear").code,
    ).toBe(0);
    expect(saved(fake, "p").proposed).toBeUndefined();
  });

  it("removes one member entry and, with its module, the rest and says how many", () => {
    const fake = repository(
      planned(
        {
          proposed: [
            { module: ORDER, kind: "changes" },
            { module: ORDER, member: "Order.total", kind: "changes" },
            { module: ORDER, member: "new_order", kind: "removed" },
          ],
        },
        pickOrder,
      ),
    );

    expect(go(fake, "remove", "p", `${ORDER}#new_order`).code).toBe(0);
    expect(saved(fake, "p").proposed).toHaveLength(2);

    const result = go(fake, "remove", "p", ORDER);

    expect(result.code).toBe(0);
    expect(result.out).toContain("dropped 1 member entry");
    expect(saved(fake, "p").proposed).toBeUndefined();
  });

  it("refuses a note on a member reference", () => {
    const fake = repository(planned({}, pickOrder));

    expect(go(fake, "note", "p", `${ORDER}#Order.total`, "hi").code).not.toBe(
      0,
    );
    expect(fake.err()).toContain(
      `notes stay at module level: ${ORDER}#Order.total`,
    );
  });

  it("shows member entries in text and json and warns about the one not in the scan", () => {
    const fake = repository(
      planned(
        {
          proposed: [
            { module: ORDER, kind: "changes" },
            { module: ORDER, member: "Order.total", kind: "changes" },
            { module: ORDER, member: "Order.gone", kind: "changes" },
          ],
        },
        pickOrder,
      ),
    );
    const text = go(fake, "show", "p").out;
    const document = JSON.parse(go(fake, "show", "p", "--json").out);

    expect(text).toContain(`  changes ${ORDER}#Order.total`);
    expect(text).toContain(
      `warning: proposed change on ${ORDER}#Order.gone is not drawn: the member is not in the scan`,
    );
    expect(document.proposed[1]).toEqual({
      module: ORDER,
      member: "Order.total",
      kind: "changes",
    });
    expect(go(fake, "check").code).toBe(0);
  });

  it("check --fix follows a rename into a member entry", () => {
    const OLD = "shop/old.py";
    const fake = repository(
      planned({ proposed: [{ module: OLD, member: "f", kind: "changes" }] }, [
        { kind: "pick", module: OLD },
      ]),
      `R100\0${OLD}\0${ORDER}\0`,
    );

    expect(go(fake, "check", "--fix").code).toBe(0);
    expect(saved(fake, "p").proposed).toEqual([
      { module: ORDER, member: "f", kind: "changes" },
    ]);
  });
});
