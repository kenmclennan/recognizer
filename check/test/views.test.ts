import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { InputError } from "../src/errors.js";
import type { Scan } from "../src/scan.js";
import {
  changeChip,
  migrateView,
  noteWarnings,
  proposedWarnings,
  resolveMembers,
  resolveView,
  serialiseView,
  type View,
  type ViewStep,
  validateView,
  viewNotes,
} from "../src/views.js";
import { REPO } from "./helpers.js";

const EXAMPLES = join(REPO, "schema/view-examples");
const scan = JSON.parse(
  readFileSync(join(REPO, "fixtures/python/expected-scan.json"), "utf8"),
) as Scan;

function view(...steps: ViewStep[]): View {
  return { schema_version: 1, description: "p", commit: null, steps };
}

function resolve(...steps: ViewStep[]) {
  return resolveView(view(...steps), [scan]);
}

describe("validateView", () => {
  it.each(readdirSync(join(EXAMPLES, "valid")))("accepts %s", (file) => {
    const value = JSON.parse(
      readFileSync(join(EXAMPLES, "valid", file), "utf8"),
    );

    expect(validateView(value)).toEqual(value);
  });

  it.each(readdirSync(join(EXAMPLES, "invalid")))("rejects %s", (file) => {
    const value = JSON.parse(
      readFileSync(join(EXAMPLES, "invalid", file), "utf8"),
    );

    expect(() => validateView(value)).toThrow(InputError);
  });

  it("compiles the schema without writing to stderr or the console", async () => {
    vi.resetModules();
    const fresh = await import("../src/views.js");
    const sinks = [
      vi.spyOn(console, "warn"),
      vi.spyOn(console, "error"),
      vi.spyOn(process.stderr, "write"),
    ];

    fresh.validateView(view());

    for (const sink of sinks) {
      expect(sink).not.toHaveBeenCalled();
      sink.mockRestore();
    }
  });
});

describe("migrateView and viewNotes", () => {
  const example = (name: string) =>
    validateView(
      JSON.parse(readFileSync(join(EXAMPLES, "valid", name), "utf8")),
    );

  it("turns a version 2 view note and module note into one notes entry", () => {
    const migrated = migrateView(example("with-notes.json"));

    expect(migrated.schema_version).toBe(4);
    expect(migrated.notes).toEqual([
      {
        module: "shop/application/place.py",
        text: "The one use case; it must not touch the store directly.",
        by: "Ken",
      },
    ]);
    expect(migrated).not.toHaveProperty("note");
    expect(migrated).not.toHaveProperty("module_notes");
  });

  it("orders migrated module notes by path", () => {
    const migrated = migrateView({
      schema_version: 2,
      description: "p",
      commit: null,
      module_notes: {
        "b.py": { text: "B", by: "Ken" },
        "a.py": { text: "A", by: "Claude" },
      },
      steps: [],
    });

    expect(migrated.notes?.map((note) => note.module)).toEqual([
      "a.py",
      "b.py",
    ]);
  });

  it("returns the same entries without rewriting", () => {
    const old = example("with-notes.json");

    expect(viewNotes(old)).toEqual(migrateView(old).notes);
    expect(old.schema_version).toBe(2);
    expect(viewNotes(example("version-3-with-notes.json"))).toHaveLength(1);
    expect(viewNotes(view())).toEqual([]);
  });

  it("migrates a version 1 view without adding notes", () => {
    expect(migrateView(view())).toEqual({
      schema_version: 4,
      description: "p",
      commit: null,
      steps: [],
    });
  });
});

describe("resolveView", () => {
  it("resolves picks, sorted", () => {
    const resolved = resolve(
      { kind: "pick", module: "shop/ports/store.py" },
      { kind: "pick", module: "shop/application/place.py" },
    );

    expect(resolved.modules).toEqual([
      "shop/application/place.py",
      "shop/ports/store.py",
    ]);
    expect(resolved.unresolved).toEqual([]);
  });

  it("puts every module under a folder rule's folder on the view", () => {
    const resolved = resolve({
      kind: "rule",
      relation: "folder",
      of: "shop/domain",
    });

    expect(resolved.modules).toHaveLength(4);
    expect(resolved.modules.every((m) => m.startsWith("shop/domain/"))).toBe(
      true,
    );
  });

  it("resolves a uses rule to what the module uses", () => {
    expect(
      resolve({
        kind: "rule",
        relation: "uses",
        of: "shop/application/place.py",
      }).modules,
    ).toEqual(["shop/domain/order.py", "shop/ports/store.py"]);
  });

  it("resolves a used-by rule, with and without within", () => {
    expect(
      resolve({ kind: "rule", relation: "used-by", of: "shop/ports/store.py" })
        .modules,
    ).toHaveLength(3);
    expect(
      resolve({
        kind: "rule",
        relation: "used-by",
        of: "shop/ports/store.py",
        within: "shop/adapters",
      }).modules,
    ).toEqual(["shop/adapters/memory_store.py"]);
  });

  it("removes left-out modules a rule put there", () => {
    expect(
      resolve(
        { kind: "rule", relation: "folder", of: "shop/domain" },
        { kind: "left-out", module: "shop/domain/__init__.py" },
        { kind: "left-out", module: "shop/domain/aliases.py" },
      ).modules,
    ).toEqual(["shop/domain/customer.py", "shop/domain/order.py"]);
  });

  it("keeps a picked module that is also left out", () => {
    expect(
      resolve(
        { kind: "pick", module: "shop/domain/order.py" },
        { kind: "left-out", module: "shop/domain/order.py" },
      ).modules,
    ).toEqual(["shop/domain/order.py"]);
  });

  it("lists a missing pick as unresolved and resolves the rest", () => {
    const resolved = resolve(
      { kind: "pick", module: "shop/domain/gone.py" },
      { kind: "pick", module: "shop/domain/order.py" },
    );

    expect(resolved.modules).toEqual(["shop/domain/order.py"]);
    expect(resolved.unresolved).toEqual([
      { step: 1, kind: "pick", path: "shop/domain/gone.py", what: "module" },
    ]);
  });

  it("lists a fold of an empty folder as unresolved and keeps real folds and focus", () => {
    const resolved = resolve(
      { kind: "fold", folder: "nowhere" },
      { kind: "fold", folder: "shop/domain" },
      { kind: "focus", folder: "shop/ports" },
    );

    expect(resolved.unresolved).toEqual([
      { step: 1, kind: "fold", path: "nowhere", what: "folder" },
    ]);
    expect(resolved.folded).toEqual(["shop/domain"]);
    expect(resolved.focus).toBe("shop/ports");
  });

  it("does not list a rule with an existing anchor and an empty result", () => {
    const resolved = resolve({
      kind: "rule",
      relation: "uses",
      of: "shop/domain/order.py",
    });

    expect(resolved.modules).toEqual([]);
    expect(resolved.unresolved).toEqual([]);
  });

  it("reports exactly the missing paths in the mixed case", () => {
    const resolved = resolve(
      { kind: "pick", module: "shop/gone.py" },
      { kind: "pick", module: "shop/domain/order.py" },
      {
        kind: "rule",
        relation: "used-by",
        of: "shop/ports/store.py",
        within: "shop/missing",
      },
    );

    expect(resolved.modules).toEqual(["shop/domain/order.py"]);
    expect(resolved.unresolved).toEqual([
      { step: 1, kind: "pick", path: "shop/gone.py", what: "module" },
      { step: 3, kind: "rule", path: "shop/missing", what: "folder" },
    ]);
  });
});

describe("one note per path", () => {
  const example = (name: string) =>
    validateView(
      JSON.parse(readFileSync(join(EXAMPLES, "valid", name), "utf8")),
    );

  const notes = (...entries: [string, string][]): View => ({
    schema_version: 3,
    description: "p",
    commit: null,
    notes: entries.map(([module, by]) => ({ module, text: `t-${by}`, by })),
    steps: [],
  });

  it("accepts a folder path with one trailing slash and rejects two", () => {
    expect(() =>
      validateView(example("version-3-folder-note.json")),
    ).not.toThrow();
    expect(() =>
      validateView(
        JSON.parse(
          readFileSync(
            join(EXAMPLES, "invalid/note-path-double-slash.json"),
            "utf8",
          ),
        ),
      ),
    ).toThrow(InputError);
  });

  it("keeps the last note on each path in the order of the kept entries", () => {
    const view3 = notes(["a.py", "1"], ["b.py", "2"], ["a.py", "3"]);

    expect(viewNotes(view3).map((n) => [n.module, n.by])).toEqual([
      ["b.py", "2"],
      ["a.py", "3"],
    ]);
    expect(migrateView(view3).notes).toEqual(viewNotes(view3));
  });

  it("warns once naming every repeated path, and not for a clean view", () => {
    const warnings = noteWarnings(
      notes(
        ["a.py", "1"],
        ["b/", "2"],
        ["a.py", "3"],
        ["b/", "4"],
        ["a.py", "5"],
      ),
    );

    expect(warnings).toEqual([
      "view holds 3 notes on a.py, b/; kept the last on each",
    ]);
    expect(noteWarnings(notes(["a.py", "1"], ["b.py", "2"]))).toEqual([]);
    expect(noteWarnings(view())).toEqual([]);
  });

  it("reads the committed legacy example as one note by Claude and one warning", () => {
    const legacy = example("version-3-with-notes.json");

    expect(viewNotes(legacy).map((n) => [n.module, n.by])).toEqual([
      ["shop/application/place.py", "Claude"],
    ]);
    expect(noteWarnings(legacy)).toEqual([
      "view holds 1 note on shop/application/place.py; kept the last on each",
    ]);
  });
});

describe("view versions", () => {
  const at = (schema_version: View["schema_version"], extra = {}): View =>
    ({
      schema_version,
      description: "p",
      commit: null,
      steps: [],
      ...extra,
    }) as View;

  it("migrates versions 2 and 3 to 4 without an ordered key", () => {
    expect(migrateView(at(2))).not.toHaveProperty("ordered");
    expect(migrateView(at(3))).toMatchObject({ schema_version: 4 });
    expect(migrateView(at(3))).not.toHaveProperty("ordered");
  });

  it("drops a stored ordered flag and writes keys in the fixed order", () => {
    const text = serialiseView(at(4, { ordered: false }));

    expect(migrateView(at(4, { ordered: false }))).not.toHaveProperty(
      "ordered",
    );
    expect(Object.keys(JSON.parse(text))).toEqual([
      "schema_version",
      "description",
      "commit",
      "steps",
    ]);
  });

  it("round-trips a title before the description and omits it when absent", () => {
    const titled = {
      schema_version: 4,
      title: "T",
      description: "p",
      commit: null,
      steps: [],
    } as View;
    const text = serialiseView(titled);

    expect(Object.keys(JSON.parse(text))).toEqual([
      "schema_version",
      "title",
      "description",
      "commit",
      "steps",
    ]);
    expect(migrateView(validateView(JSON.parse(text))).title).toBe("T");
    expect(serialiseView(at(4))).not.toContain("title");
  });

  it("counts the examples", () => {
    expect(readdirSync(join(EXAMPLES, "valid"))).toHaveLength(14);
    expect(readdirSync(join(EXAMPLES, "invalid"))).toHaveLength(44);
  });
});

describe("change views", () => {
  const change: View = {
    schema_version: 4,
    description: "p",
    commit: null,
    change: { base: "main", head: "feat" },
    steps: [],
  };

  it("round-trips the range between commit and steps", () => {
    const text = serialiseView(change);

    expect(Object.keys(JSON.parse(text))).toEqual([
      "schema_version",
      "description",
      "commit",
      "change",
      "steps",
    ]);
    expect(migrateView(validateView(JSON.parse(text))).change).toEqual(
      change.change,
    );
    expect(Object.keys(JSON.parse(text))).toEqual([
      "schema_version",
      "description",
      "commit",
      "change",
      "steps",
    ]);
    expect(Object.keys(JSON.parse(text).change)).toEqual(["base", "head"]);
  });

  it("keeps a named change's name, after base and head", () => {
    const named: View = {
      ...change,
      change: { name: "branch feat", head: "feat", base: "main" },
    };
    const text = serialiseView(named);

    expect(Object.keys(JSON.parse(text).change)).toEqual([
      "base",
      "head",
      "name",
    ]);
    expect(migrateView(validateView(JSON.parse(text))).change?.name).toBe(
      "branch feat",
    );
  });

  it("rejects a blank change name", () => {
    expect(() =>
      validateView({
        ...JSON.parse(serialiseView(change)),
        change: { base: "main", head: "feat", name: " " },
      }),
    ).toThrow(InputError);
  });
});

describe("changeChip", () => {
  const hex40 = (c: string) => c.repeat(40);

  it("returns a stored name with the full range as the title", () => {
    expect(
      changeChip({ base: "main", head: "feat", name: "branch feat" }),
    ).toEqual({ text: "branch feat", title: "main..feat" });
  });

  it("shortens two 40-hex refs to 8 characters", () => {
    expect(changeChip({ base: hex40("a"), head: hex40("b") })).toEqual({
      text: "aaaaaaaa..bbbbbbbb",
      title: `${hex40("a")}..${hex40("b")}`,
    });
  });

  it("returns branch names whole", () => {
    expect(changeChip({ base: "main", head: "feat" }).text).toBe("main..feat");
  });

  it("shortens a 64-hex ref", () => {
    expect(changeChip({ base: "c".repeat(64), head: "main" }).text).toBe(
      "cccccccc..main",
    );
  });

  it("returns a 39-hex string whole", () => {
    expect(changeChip({ base: "d".repeat(39), head: "main" }).text).toBe(
      `${"d".repeat(39)}..main`,
    );
  });

  it("returns a 40-character string with a non-hex letter whole", () => {
    const ref = `${"e".repeat(39)}g`;

    expect(changeChip({ base: ref, head: "main" }).text).toBe(`${ref}..main`);
  });
});

describe("plan views", () => {
  const plan = (proposed: View["proposed"], ...steps: ViewStep[]): View => ({
    schema_version: 4,
    description: "p",
    commit: null,
    plan: true,
    proposed,
    steps,
  });
  const pick = (module: string): ViewStep => ({ kind: "pick", module });
  const NEW = "shop/application/discount.py";
  const ORDER = "shop/domain/order.py";

  it("serialises every view file already committed to the same text as before plans existed", () => {
    const pins = JSON.parse(
      readFileSync(
        join(REPO, "check/test/fixtures/view-serialised-pins.json"),
        "utf8",
      ),
    ) as Record<string, string>;
    const files = readdirSync(join(EXAMPLES, "valid")).filter(
      (file) =>
        file !== "version-4-plan.json" &&
        file !== "version-4-plan-members.json",
    );

    expect(Object.keys(pins).sort()).toEqual(files.sort());

    for (const file of files) {
      const text = serialiseView(
        validateView(
          JSON.parse(readFileSync(join(EXAMPLES, "valid", file), "utf8")),
        ),
      );

      expect(text, file).toBe(pins[file]);
      expect(text).not.toContain('"plan"');
      expect(text).not.toContain('"proposed"');
    }
  });

  it("keeps plan and proposed through migrate and serialise in the documented order", () => {
    const example = validateView(
      JSON.parse(
        readFileSync(join(EXAMPLES, "valid/version-4-plan.json"), "utf8"),
      ),
    );
    const text = serialiseView(example);
    const parsed = JSON.parse(text);

    expect(Object.keys(parsed)).toEqual([
      "schema_version",
      "description",
      "commit",
      "plan",
      "notes",
      "proposed",
      "steps",
    ]);
    expect(parsed.proposed).toHaveLength(5);
    expect(Object.keys(parsed.proposed[2])).toEqual(["module", "kind", "from"]);
    expect(migrateView(example).proposed).toEqual(example.proposed);
    expect(serialiseView(validateView(parsed))).toBe(text);
  });

  it("keeps the last proposed change on a module and warns", () => {
    const doubled = plan(
      [
        { module: ORDER, kind: "new" },
        { module: ORDER, kind: "removed" },
      ],
      pick(ORDER),
    );

    expect(migrateView(doubled).proposed).toEqual([
      { module: ORDER, kind: "removed" },
    ]);
    expect(proposedWarnings(doubled, resolveView(doubled, [scan]))).toEqual([
      `view holds 1 proposed change on ${ORDER}; kept the last on each`,
    ]);
  });

  it("puts a new module that is not in the scan on the plan and never stale", () => {
    const resolved = resolveView(
      plan([{ module: NEW, kind: "new" }], pick(ORDER)),
      [scan],
    );

    expect(resolved.planned).toEqual([NEW]);
    expect(resolved.modules).toEqual([ORDER]);
    expect(resolved.unresolved).toEqual([]);
  });

  it("leaves exactly the changes module that is not in the scan unresolved", () => {
    const view = plan(
      [
        { module: NEW, kind: "new" },
        { module: ORDER, kind: "changes" },
        { module: "shop/domain/gone.py", kind: "changes" },
      ],
      pick(ORDER),
      pick("shop/domain/gone.py"),
    );
    const resolved = resolveView(view, [scan]);

    expect(resolved.planned).toEqual([NEW]);
    expect(resolved.modules).toEqual([ORDER]);
    expect(resolved.unresolved).toEqual([
      { step: 2, kind: "pick", path: "shop/domain/gone.py", what: "module" },
    ]);
  });

  it("does not plan a changes or removed module that is not in the scan", () => {
    const resolved = resolveView(
      plan([
        { module: "shop/gone.py", kind: "changes" },
        { module: "shop/also-gone.py", kind: "removed" },
      ]),
      [scan],
    );

    expect(resolved.planned).toEqual([]);
  });

  it("keeps a planned module off the view when a left-out step names it", () => {
    const resolved = resolveView(
      plan([{ module: NEW, kind: "new" }], { kind: "left-out", module: NEW }),
      [scan],
    );

    expect(resolved.planned).toEqual([]);
  });

  it("yields a ghost for a move whether or not from is in the scan", () => {
    const resolved = resolveView(
      plan([
        { module: "shop/new/a.py", kind: "moves", from: ORDER },
        {
          module: "shop/new/b.py",
          kind: "moves-and-changes",
          from: "shop/never/was.py",
        },
      ]),
      [scan],
    );

    expect(resolved.ghosts).toEqual([
      { from: ORDER, to: "shop/new/a.py" },
      { from: "shop/never/was.py", to: "shop/new/b.py" },
    ]);
    expect(resolved.planned).toEqual(["shop/new/a.py", "shop/new/b.py"]);
  });

  it("treats a new module that exists in the scan as an ordinary module", () => {
    const resolved = resolveView(
      plan([{ module: ORDER, kind: "new" }], pick(ORDER)),
      [scan],
    );

    expect(resolved.planned).toEqual([]);
    expect(resolved.modules).toEqual([ORDER]);
  });

  it("warns about a proposed change on a module that is not on the view", () => {
    const view = plan([{ module: ORDER, kind: "changes" }]);

    expect(proposedWarnings(view, resolveView(view, [scan]))).toEqual([
      `proposed change on ${ORDER} is not drawn: the module is not on the view`,
    ]);
  });
});

describe("member entries in a plan", () => {
  const ORDER = "shop/domain/order.py";
  const plan = (proposed: View["proposed"], ...steps: ViewStep[]): View => ({
    schema_version: 4,
    description: "p",
    commit: null,
    plan: true,
    proposed,
    steps,
  });
  const pick = (module: string): ViewStep => ({ kind: "pick", module });

  it("keeps member entries through serialise in key order", () => {
    const example = validateView(
      JSON.parse(
        readFileSync(
          join(EXAMPLES, "valid/version-4-plan-members.json"),
          "utf8",
        ),
      ),
    );
    const parsed = JSON.parse(serialiseView(example));

    expect(parsed.proposed).toHaveLength(4);
    expect(Object.keys(parsed.proposed[1])).toEqual([
      "module",
      "member",
      "kind",
    ]);
    expect(serialiseView(validateView(parsed))).toBe(serialiseView(example));
  });

  it("keeps the last entry on one module and member and warns", () => {
    const doubled = plan(
      [
        { module: ORDER, member: "Order.total", kind: "new" },
        { module: ORDER, member: "Order.total", kind: "changes" },
        { module: ORDER, kind: "changes" },
      ],
      pick(ORDER),
    );

    expect(migrateView(doubled).proposed).toEqual([
      { module: ORDER, member: "Order.total", kind: "changes" },
      { module: ORDER, kind: "changes" },
    ]);
    expect(proposedWarnings(doubled, resolveView(doubled, [scan]))).toEqual([
      `view holds 1 proposed change on ${ORDER}#Order.total; kept the last on each`,
    ]);
  });

  it("draws a changes member in the scan and a new member not in it, and reports only the changes member that is not in the scan", () => {
    const view = plan(
      [
        { module: ORDER, member: "Order.total", kind: "changes" },
        { module: ORDER, member: "Order.vanished", kind: "changes" },
        { module: ORDER, member: "Order.apply_discount", kind: "new" },
      ],
      pick(ORDER),
    );
    const resolved = resolveMembers(view, [scan]);

    expect(resolved.byModule.get(ORDER)).toEqual([
      { module: ORDER, member: "Order.total", kind: "changes", inScan: true },
      {
        module: ORDER,
        member: "Order.apply_discount",
        kind: "new",
        inScan: false,
      },
    ]);
    expect(resolved.warnings).toEqual([
      `proposed change on ${ORDER}#Order.vanished is not drawn: the member is not in the scan`,
    ]);
    expect(resolveView(view, [scan]).unresolved).toEqual([]);
  });

  it("draws a new member the scan already holds as an ordinary row", () => {
    const view = plan(
      [{ module: ORDER, member: "new_order", kind: "new" }],
      pick(ORDER),
    );

    expect(resolveMembers(view, [scan]).byModule.get(ORDER)).toEqual([
      { module: ORDER, member: "new_order", kind: "new", inScan: true },
    ]);
  });

  it("ignores a member entry on a planned or wholly removed module with a warning", () => {
    const view = plan(
      [
        { module: "shop/application/discount.py", kind: "new" },
        {
          module: "shop/application/discount.py",
          member: "Discount",
          kind: "new",
        },
        { module: ORDER, kind: "removed" },
        { module: ORDER, member: "Order", kind: "removed" },
      ],
      pick(ORDER),
    );
    const resolved = resolveMembers(view, [scan]);

    expect(resolved.byModule.size).toBe(0);
    expect(resolved.warnings).toEqual([
      "proposed change on shop/application/discount.py#Discount is not drawn: shop/application/discount.py is planned",
      `proposed change on ${ORDER}#Order is not drawn: ${ORDER} is wholly removed`,
    ]);
  });

  it("warns about a member entry whose module is not on the view", () => {
    const view = plan([{ module: ORDER, member: "Order", kind: "changes" }]);

    expect(resolveMembers(view, [scan]).warnings).toEqual([
      `proposed change on ${ORDER}#Order is not drawn: the module is not on the view`,
    ]);
  });
});
