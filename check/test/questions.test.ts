import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { REPO } from "./helpers.js";
import { fakeIo, PYTHON, ROOT, scanJson } from "./scan-helpers.js";

const COMMIT = "abc123";
const CACHE = `${ROOT}/.recognizer/cache/scan.python.json`;
const fixture = JSON.parse(
  readFileSync(join(REPO, "fixtures/python/expected-scan.json"), "utf8"),
);

function repository(scan: unknown = { ...fixture, commit: COMMIT }) {
  return fakeIo({
    commit: COMMIT,
    files: {
      [`${ROOT}/shop/a.py`]: "",
      [CACHE]: JSON.stringify(scan),
    },
  });
}

function ask(argv: string[], scan?: unknown) {
  const fake = repository(scan);
  const code = run([...argv, "--repository", ROOT], fake.io);

  return { code, out: fake.out(), err: fake.err(), fake };
}

describe("used-by", () => {
  it("groups the four users of order.py by folder in text", () => {
    const { code, out } = ask(["used-by", "shop/domain/order.py"]);

    expect(code).toBe(0);
    expect(out.split("\n")[0]).toBe(
      "shop/domain/order.py is used by 4 modules",
    );
    expect(out.split("\n").filter((line) => line.endsWith("/"))).toEqual([
      "shop/",
      "shop/application/",
      "shop/domain/",
    ]);
  });

  it("groups them the same way in json", () => {
    const { code, out } = ask(["used-by", "shop/domain/order.py", "--json"]);
    const document = JSON.parse(out);

    expect(code).toBe(0);
    expect(document.direction).toBe("usedBy");
    expect(document.count).toBe(4);
    expect(
      document.groups.map((group: { folder: string }) => group.folder),
    ).toEqual(["shop", "shop/application", "shop/domain"]);
  });
});

describe("uses", () => {
  it("lists order.py with its names and the store port", () => {
    const { out } = ask(["uses", "shop/application/place.py", "--json"]);
    const rows = JSON.parse(out).groups.flatMap(
      (group: { modules: { id: string; names: string[] }[] }) => group.modules,
    );

    expect(rows.map((row: { id: string }) => row.id)).toEqual([
      "shop/domain/order.py",
      "shop/ports/store.py",
    ]);
    expect(rows[0].names).toEqual(["new_order", "Order"]);
  });

  it("prints names in text", () => {
    const { out } = ask(["uses", "shop/application/place.py"]);

    expect(out).toContain("  shop/domain/order.py  new_order, Order");
    expect(out).toContain("shop/application/place.py uses 2 modules");
  });

  it("is exit 0 with a count of 0 for a module that uses nothing", () => {
    const { code, out } = ask(["uses", "shop/domain/order.py", "--json"]);

    expect(code).toBe(0);
    expect(JSON.parse(out).count).toBe(0);
  });
});

describe("path", () => {
  it("is two steps through memory_store.py", () => {
    const { code, out } = ask([
      "path",
      "shop/adapters/special_store.py",
      "shop/ports/store.py",
    ]);

    expect(code).toBe(0);
    expect(out).toContain("reaches shop/ports/store.py in 2 steps");
    expect(out).toContain(
      "shop/adapters/special_store.py -> shop/adapters/memory_store.py",
    );
  });

  it("exits 1 with found false when unreachable, and 0 when reachable, in one repository", () => {
    const missing = ask([
      "path",
      "shop/ports/store.py",
      "shop/adapters/special_store.py",
      "--json",
    ]);
    const found = ask([
      "path",
      "shop/adapters/special_store.py",
      "shop/ports/store.py",
      "--json",
    ]);

    expect(missing.code).toBe(1);
    expect(JSON.parse(missing.out)).toMatchObject({ found: false, steps: [] });
    expect(found.code).toBe(0);
    expect(JSON.parse(found.out).found).toBe(true);
  });

  it("reaches itself in no steps", () => {
    const { code, out } = ask([
      "path",
      "shop/ports/store.py",
      "shop/ports/store.py",
      "--json",
    ]);

    expect(code).toBe(0);
    expect(JSON.parse(out)).toMatchObject({ found: true, steps: [] });
  });

  it("prints a message in text when there is no path", () => {
    const { out } = ask([
      "path",
      "shop/ports/store.py",
      "shop/adapters/special_store.py",
    ]);

    expect(out).toBe(
      "no path from shop/ports/store.py to shop/adapters/special_store.py\n",
    );
  });
});

describe("callers", () => {
  it("lists refund.py for Store.save", () => {
    const { code, out } = ask([
      "callers",
      "shop/ports/store.py",
      "Store.save",
      "--json",
    ]);

    expect(code).toBe(0);
    expect(JSON.parse(out).callers).toEqual([
      { module: "shop/application/refund.py", through: null },
    ]);
  });

  it("lists refund.py through Store for MemoryStore.save, in text", () => {
    const { out } = ask([
      "callers",
      "shop/adapters/memory_store.py",
      "MemoryStore.save",
    ]);

    expect(out).toContain("  shop/application/refund.py (through Store)");
    expect(out).toContain("built: no");
  });

  it("exits 2 when the scan has no call data", () => {
    const { calls: _, ...withoutCalls } = fixture;
    const { code, err } = ask(
      ["callers", "shop/ports/store.py", "Store.save"],
      { ...withoutCalls, commit: COMMIT },
    );

    expect(code).toBe(2);
    expect(err).toContain("scan has no call data for shop/ports/store.py");
  });
});

describe("question input errors", () => {
  it("exits 2 for an unknown module", () => {
    const { code, err } = ask(["uses", "nope.py"]);

    expect(code).toBe(2);
    expect(err).toBe("no such module: nope.py\n");
  });

  it("exits 2 for the wrong argument count", () => {
    const { code, err } = ask(["path", "shop/ports/store.py"]);

    expect(code).toBe(2);
    expect(err).toContain("usage: recognizer path <from> <to>");
  });
});

describe("a scan that runs first", () => {
  it("keeps stdout to the answer", () => {
    const stale = scanJson(2, 1, { commit: COMMIT });
    const fake = fakeIo({
      commit: COMMIT,
      status: " M shop/a.py\n",
      files: { [`${ROOT}/shop/a.py`]: "" },
      scanners: { [PYTHON]: { output: stale } },
    });

    const code = run(
      ["uses", "m0.py", "--repository", ROOT, "--json"],
      fake.io,
    );

    expect(code).toBe(0);
    expect(JSON.parse(fake.out()).module).toBe("m0.py");
    expect(fake.err()).toContain("python: 2 modules, 1 edges");
  });
});
