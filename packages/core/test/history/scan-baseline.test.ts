import { describe, expect, it } from "vitest";
import {
  adoptScanBaseline,
  clearScanOrigin,
  compareScanBaseline,
  pollScanChanges,
  takeScanOrigin,
} from "../../src/index.js";
import { sha256 } from "../fakes/fake-work-tree.js";
import {
  baselineOf,
  pythonRepository,
  pythonWith,
  ROOT,
  ScanWorld,
  WINDOW,
} from "./scan-world.js";

function typescriptSample(): { world: ScanWorld } {
  const world = new ScanWorld();

  world.copyFixture("typescript");
  world.useCommittedScan("typescript");
  world.adopt();

  return { world };
}

function sampleOf(language: string): ScanWorld {
  const world = new ScanWorld();

  world.copyFixture(language);
  world.useCommittedScan(language);
  world.adopt();

  return world;
}

describe("ScanBaseline", () => {
  it("the committed typescript scan lists the manifests it read", async () => {
    const { world } = typescriptSample();

    expect(await world.listed()).toEqual([]);
  });

  it("editing a manifest the scan read reports it modified", async () => {
    const { world } = typescriptSample();
    const manifest = world.tree.files.get("api/package.json") as string;

    world.write("api/package.json", `${manifest}\n`);

    expect(await world.listed()).toEqual([["api/package.json", "modified"]]);
  });

  it("deleting a config the scan read reports it deleted", async () => {
    const { world } = typescriptSample();

    world.remove("web/tsconfig.json");

    expect(await world.listed()).toEqual([["web/tsconfig.json", "deleted"]]);
  });

  it("a failed git listing reads as none, so the poll walks and finds an added file", async () => {
    const world = pythonRepository();
    const baseline = baselineOf(world, ["python"]);

    world.write("app/c.py", "c = 1\n");
    world.repositoryFiles.gitless = true;

    expect(await world.listed(baseline)).toContainEqual(["app/c.py", "added"]);
    expect(world.repositoryFiles.calls[0]).toBe("list");
  });

  it("a successful git listing is used as is", async () => {
    const world = pythonRepository();
    const baseline = baselineOf(world, ["python"]);

    world.write("app/c.py", "c = 1\n");
    world.write("app/d.py", "d = 1\n");
    world.repositoryFiles.listed = ["app/a.py", "app/b.py", "app/c.py"];

    const changes = await compareScanBaseline(world.ports, baseline, ROOT);
    const kinds = changes.files.map((change) => [change.path, change.kind]);

    expect(kinds).toContainEqual(["app/c.py", "added"]);
    expect(kinds).not.toContainEqual(["app/d.py", "added"]);
  });

  it("an empty git listing is a listing, not a failure", async () => {
    const world = pythonRepository();
    const baseline = baselineOf(world, ["python"]);

    world.write("app/c.py", "c = 1\n");
    world.repositoryFiles.listed = [];

    const changes = await compareScanBaseline(world.ports, baseline, ROOT);

    expect(changes.files.filter((change) => change.kind === "added")).toEqual(
      [],
    );
  });

  it("a manifest added after the scan is reported added", async () => {
    const { world } = typescriptSample();

    world.write("extra/package.json", "{}\n");

    expect(await world.listed()).toEqual([["extra/package.json", "added"]]);
  });

  it("a page added after the scan is reported added", async () => {
    const { world } = typescriptSample();

    world.write("extra/page.html", "<html></html>\n");

    expect(await world.listed()).toEqual([["extra/page.html", "added"]]);
  });

  it("a manifest under a skipped directory is not reported", async () => {
    const { world } = typescriptSample();

    world.write("node_modules/x/package.json", "{}\n");

    expect(await world.listed()).toEqual([]);
  });

  it("a build file deleted from the kotlin sample is reported deleted", async () => {
    const world = sampleOf("kotlin");

    expect(await world.listed()).toEqual([]);

    world.remove("app/build.gradle.kts");

    expect(await world.listed()).toEqual([["app/build.gradle.kts", "deleted"]]);
  });

  it("a build file added to the kotlin sample is reported added", async () => {
    const world = sampleOf("kotlin");

    world.write("app/other/build.gradle", "\n");

    expect(await world.listed()).toEqual([["app/other/build.gradle", "added"]]);
  });

  it("an absent path that appears is reported added and one that does not is not", async () => {
    const world = new ScanWorld();
    const baseline = pythonWith(world, { input_absent_paths: ["setup.cfg"] });

    expect(await world.listed(baseline)).toEqual([]);

    world.write("setup.cfg", "[options]\n");

    expect(await world.listed(baseline)).toEqual([["setup.cfg", "added"]]);
  });

  it("a new skip marker is reported added", async () => {
    const world = pythonRepository();
    const baseline = pythonWith(world, {
      skip_directories_containing: ["pyvenv.cfg"],
    });

    world.write("env/pyvenv.cfg", "home = /usr\n");

    expect(await world.listed(baseline)).toContainEqual([
      "env/pyvenv.cfg",
      "added",
    ]);
  });

  it("a scan without the input keys reports no added manifest", async () => {
    const world = new ScanWorld();
    const baseline = pythonWith(world, {});

    world.write("extra/package.json", "{}\n");
    world.write("setup.cfg", "\n");

    expect(await world.listed(baseline)).toEqual([]);
  });

  it("candidates does not return a manifest the input rule reports", async () => {
    const world = new ScanWorld();
    const baseline = pythonWith(world, { input_file_globs: ["package.json"] });

    world.write("package.json", "{}\n");
    world.write("a.py", "a = 1\n");
    world.refresh();

    const present = new Set<string>();
    const listing = ["a.py", "package.json"];

    expect(baseline.candidates(listing, present)).toEqual(["a.py"]);
    expect(
      baseline.inputsAdded({
        listing,
        present,
        appearing: new Set(),
      }),
    ).toEqual(["package.json"]);
  });

  it("an edit counts", async () => {
    const world = pythonRepository();
    const baseline = baselineOf(world, ["python", "typescript"]);

    world.write("app/a.py", "a = 2\n");

    expect(await world.listed(baseline)).toEqual([["app/a.py", "modified"]]);
  });

  it("an added file in a covered language counts", async () => {
    const world = pythonRepository();
    const baseline = baselineOf(world, ["python"]);

    world.write("app/new.py", "n = 1\n");

    expect(await world.listed(baseline)).toEqual([["app/new.py", "added"]]);
  });

  it("a deleted file counts", async () => {
    const world = pythonRepository();
    const baseline = baselineOf(world, ["python"]);

    world.remove("app/b.py");

    expect(await world.listed(baseline)).toEqual([["app/b.py", "deleted"]]);
  });

  it("a file edited twice is one entry", async () => {
    const world = pythonRepository();
    const baseline = baselineOf(world, ["python"]);

    world.write("app/a.py", "a = 2\n");
    world.write("app/a.py", "a = 3\n");

    expect((await world.compare(baseline)).files).toHaveLength(1);
  });

  it("a file edited and then deleted is one deleted entry", async () => {
    const world = pythonRepository();
    const baseline = baselineOf(world, ["python"]);

    world.write("app/a.py", "a = 2\n");
    world.remove("app/a.py");

    expect(await world.listed(baseline)).toEqual([["app/a.py", "deleted"]]);
  });

  it("an edit made and then reversed does not count", async () => {
    const world = pythonRepository();
    const baseline = baselineOf(world, ["python"]);

    world.write("app/a.py", "a = 2\n");
    world.write("app/a.py", "a = 1\n");

    expect((await world.compare(baseline)).files).toEqual([]);
  });

  it("a change under the recognizer folder does not count", async () => {
    const world = pythonRepository();
    const baseline = baselineOf(world, ["python", "typescript"]);

    world.write(".recognizer/views/x.py", "x = 1\n");

    expect((await world.compare(baseline)).files).toEqual([]);
  });

  it("files the python scanner skips do not count", async () => {
    const world = pythonRepository();
    const baseline = baselineOf(world, ["python"]);

    world.write("app/tests/test_a.py", "x = 1\n");
    world.write("app/conftest.py", "x = 1\n");
    world.write("app/test/b_test.py", "x = 1\n");
    world.write("app/notes.txt", "x\n");
    world.write("venv/pyvenv.cfg", "home = x\n");
    world.write("venv/lib/m.py", "x = 1\n");

    expect(await world.listed(baseline)).toEqual([
      ["venv/pyvenv.cfg", "added"],
    ]);
  });

  it("files the typescript scanner skips do not count", async () => {
    const world = pythonRepository();
    const baseline = baselineOf(world, ["typescript"]);

    world.write("web/c.test.ts", "x\n");
    world.write("web/c.spec.tsx", "x\n");
    world.write("web/types.d.ts", "x\n");
    world.write("web/__tests__/d.ts", "x\n");
    world.write("web/tests/d.ts", "x\n");
    world.write("web/readme.md", "x\n");

    expect((await world.compare(baseline)).files).toEqual([]);
  });

  it("a new python file does not count when only typescript was scanned", async () => {
    const world = pythonRepository();
    const baseline = baselineOf(world, ["typescript"]);

    world.write("app/new.py", "n = 1\n");

    expect((await world.compare(baseline)).files).toEqual([]);
  });

  it("a mixed change lists exactly its files sorted by path", async () => {
    const world = pythonRepository();
    const baseline = baselineOf(world, ["python"]);

    world.write("app/z.py", "z = 1\n");
    world.write("app/a.py", "a = 2\n");
    world.remove("app/b.py");

    expect(await world.listed(baseline)).toEqual([
      ["app/a.py", "modified"],
      ["app/b.py", "deleted"],
      ["app/z.py", "added"],
    ]);
  });

  it("a test file new in a directory the recorded selection skips does not count", async () => {
    const world = pythonRepository();
    const baseline = baselineOf(world, ["python", "typescript"]);

    world.write("app/tests/new.py", "n = 1\n");
    world.write("web/__tests__/new.ts", "n\n");
    world.write("web/.hidden/new.ts", "n\n");

    expect((await world.compare(baseline)).files).toEqual([]);
  });

  it("the baseline holds the hashes the scan recorded and the origin taken before", () => {
    const world = pythonRepository();

    takeScanOrigin(world.ports, world.windows, WINDOW, ROOT);
    world.recordScan("python");

    const adopted = adoptScanBaseline(world.ports, world.windows, WINDOW, ROOT);
    const baseline = world.baseline();

    expect([...baseline.hashes.keys()].sort()).toEqual([
      "app/a.py",
      "app/b.py",
    ]);
    expect(baseline.hashes.get("app/a.py")).toBe(sha256("a = 1\n"));
    expect(baseline.selections).toHaveLength(1);
    expect(adopted).toEqual({ branch: "main", commit: "abcdef0" });
  });

  it("a scan that cannot be read contributes nothing", () => {
    const world = pythonRepository();

    takeScanOrigin(world.ports, world.windows, WINDOW, ROOT);
    adoptScanBaseline(world.ports, world.windows, WINDOW, ROOT);

    expect(world.baseline().hashes.size).toBe(0);
    expect(world.baseline().selections).toHaveLength(0);
  });

  it("a verified file is not read again while its stamp holds", async () => {
    const world = pythonRepository();
    const baseline = baselineOf(world, ["python"]);

    expect((await world.compare(baseline)).files).toEqual([]);
    expect(baseline.verifiedCount).toBe(2);
    expect(world.tree.hashed).toHaveLength(2);

    await world.compare(baseline);

    expect(world.tree.hashed).toHaveLength(2);
  });

  it("polling twice with nothing between publishes once", async () => {
    const world = pythonRepository();

    baselineOf(world, ["python"]);
    world.write("app/a.py", "a = 2\n");
    world.refresh();

    const first = await pollScanChanges(
      world.ports,
      world.windows,
      WINDOW,
      ROOT,
    );

    expect(first.changed).toBe(true);
    expect(first.changed && first.changes.files.length).toBeGreaterThan(0);

    const second = await pollScanChanges(
      world.ports,
      world.windows,
      WINDOW,
      ROOT,
    );

    expect(second).toEqual({ changed: false });
  });

  it("a poll for a window with no state is not changed", async () => {
    const world = pythonRepository();

    baselineOf(world, ["python"]);
    world.write("app/a.py", "a = 2\n");
    world.refresh();
    clearScanOrigin(world.windows, WINDOW, true);

    expect(
      await pollScanChanges(world.ports, world.windows, WINDOW, ROOT),
    ).toEqual({ changed: false });
  });

  it("adopting with no pending origin is refused with the Rust message", () => {
    const world = pythonRepository();

    expect(() =>
      adoptScanBaseline(world.ports, world.windows, WINDOW, ROOT),
    ).toThrow("no scan is waiting to be adopted");
  });
});
