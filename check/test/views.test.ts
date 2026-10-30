import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { InputError } from "../src/errors.js";
import type { Scan } from "../src/scan.js";
import {
  migrateView,
  resolveView,
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

    expect(migrated.schema_version).toBe(3);
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
    expect(viewNotes(example("version-3-with-notes.json"))).toHaveLength(2);
    expect(viewNotes(view())).toEqual([]);
  });

  it("migrates a version 1 view without adding notes", () => {
    expect(migrateView(view())).toEqual({
      schema_version: 3,
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
