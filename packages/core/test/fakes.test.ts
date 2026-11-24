import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Repository } from "../src/index.js";
import { createFakes } from "./fakes/container.js";
import { cachePath } from "./fakes/fake-structure-repository.js";
import { repositoryOf } from "./fakes/repository-of.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("fakes", () => {
  it("every port except Scan has a fake", () => {
    const application = resolve(here, "../src/application");
    const ports = readdirSync(application, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) =>
        existsSync(join(application, entry.name, "ports"))
          ? readdirSync(join(application, entry.name, "ports")).map(
              (name) => `${entry.name}/ports/${name}`,
            )
          : [],
      )
      .filter((name) => name.endsWith(".ts"))
      .filter(
        (name) =>
          !["describing/ports/describer-ref.ts", "run/ports/scan.ts"].includes(
            name,
          ),
      )
      .map((name) => (name.split("/").pop() as string).replace(/\.ts$/, ""))
      .sort();
    const fakes = createFakes();
    const fakeKeys = Object.keys(fakes).sort();

    expect(ports).toEqual([
      "analysis",
      "assistant",
      "changes",
      "check-sandbox",
      "clock",
      "config-keys",
      "confirm",
      "describer",
      "digest",
      "document-validators",
      "git",
      "parsing",
      "plugin-registry",
      "plugin-templates",
      "process",
      "programs",
      "repository-checks",
      "scan-cache",
      "scan-lock",
      "scanners",
      "scratch",
      "selection-files",
      "sensor-catalog",
      "sensors",
      "setup-files",
      "setup-programs",
      "setup-scan",
      "shipped-plugins",
      "source-files",
      "survey-plugins",
      "test-reports",
      "windows",
    ]);
    expect(fakeKeys).toEqual(
      [
        "analysis",
        "assistant",
        "baseline",
        "catalog",
        "changes",
        "checkSandbox",
        "clock",
        "config",
        "configKeys",
        "confirm",
        "describer",
        "digest",
        "documentValidators",
        "files",
        "findings",
        "git",
        "lock",
        "parsing",
        "pluginRegistry",
        "pluginTemplates",
        "policy",
        "process",
        "programs",
        "repositoryChecks",
        "runLog",
        "scanCache",
        "scanners",
        "scratch",
        "sensors",
        "setupFiles",
        "setupScan",
        "shippedPlugins",
        "source",
        "structure",
        "surveyPlugins",
        "testReports",
        "views",
        "windows",
      ].sort(),
    );
    expect(
      readdirSync(join(here, "fakes")).filter((name) =>
        name.startsWith("fake-"),
      ),
    ).toHaveLength(fakeKeys.length);
  });

  it("the scan lock refuses a second acquire and release is idempotent", () => {
    const { lock } = createFakes();
    const first = lock.acquire("/repo", { sensors: [], describe: false });

    expect(first.ok).toBe(true);
    expect(lock.acquire("/repo", { sensors: [], describe: false }).ok).toBe(
      false,
    );

    if (first.ok) {
      first.lock.release();
      first.lock.release();
    }

    expect(lock.acquire("/repo", { sensors: [], describe: false }).ok).toBe(
      true,
    );
  });

  it("git returns the commit it was given and the dirty flag", () => {
    const { git } = createFakes("abc123");

    expect(git.commit()).toBe("abc123");
    expect(git.dirty()).toBe(false);

    git.modified = true;

    expect(git.dirty()).toBe(true);
  });

  it("git resolves only valid refs it knows, and treats equal commits as ancestors", () => {
    const { git } = createFakes();

    git.refs.set("main", "c1");
    git.refs.set("a..b", "never");
    git.ancestors.add("c1>c2");
    git.renames.set("c1", new Map([["a", "b"]]));

    expect(git.resolveRef("/r", "main")).toBe("c1");
    expect(git.resolveRef("/r", "a..b")).toBeNull();
    expect(git.resolveRef("/r", "unknown")).toBeNull();
    expect(git.isAncestor("/r", "c1", "c2")).toBe(true);
    expect(git.isAncestor("/r", "c1", "c1")).toBe(true);
    expect(git.isAncestor("/r", "c2", "c1")).toBe(false);
    expect(git.renamesSince("/r", "c1").get("a")).toBe("b");
    expect(git.renamesSince("/r", "c9").size).toBe(0);
  });

  it("scanners report the counts they were told and remove nothing themselves", async () => {
    const fakes = createFakes();

    fakes.scanners.languages.set("alpha", {
      modules: 4,
      edges: 7,
      fails: false,
    });
    fakes.structure.save("/repo", "alpha", repositoryOf({}, [], "alpha"));

    const result = await fakes.scanners.extract({
      root: "/repo",
      language: "alpha",
      commit: "c",
      modified: false,
      limits: { pluginLimits: true },
      onEvent: () => {},
      say: () => {},
    });

    expect(result).toMatchObject({ ok: true, modules: 4, edges: 7 });

    const invented = fakes.scanners.languages.get("alpha");

    if (invented !== undefined) {
      invented.fails = true;
    }

    await fakes.scanners.extract({
      root: "/repo",
      language: "alpha",
      commit: "c",
      modified: false,
      limits: { pluginLimits: true },
      onEvent: () => {},
      say: () => {},
    });

    expect(fakes.structure.scans.has(cachePath("/repo", "alpha"))).toBe(true);
  });
});

describe("the fake repositories read", () => {
  it("the_fake_repositories_read_what_they_were_given", () => {
    const { structure, findings } = createFakes();
    const python = repositoryOf({ "a.py": "ha" }, [], "python");
    const kotlin = repositoryOf({ "B.kt": "hb" }, [], "kotlin");

    structure.save("/repo", "python", python);
    structure.save("/repo", "kotlin", kotlin);
    findings.measured.set("/repo::crap", {
      inputs: { "a.py": "ha" },
      tests: "t",
    });
    findings.tests = "t";
    structure.kinds.set("/repo", {
      registered: true,
      kinds: { "a.py": "current", "B.kt": "missing" },
    });

    expect(structure.read("/repo")).toEqual(Repository.join([kotlin, python]));
    expect(structure.read("/other")).toEqual(Repository.join([]));
    expect(findings.measuredOf("/repo", "crap")).toEqual({
      inputs: { "a.py": "ha" },
      tests: "t",
    });
    expect(findings.measuredOf("/repo", "mutation")).toBeNull();
    expect(findings.testsDigest()).toBe("t");
    expect(structure.responsibilityKinds("/repo").kinds["B.kt"]).toBe(
      "missing",
    );
    expect(structure.responsibilityKinds("/other")).toEqual({
      registered: false,
      kinds: {},
    });
  });

  it("the fake repositories agree with the adapters on absent data", () => {
    const { structure, findings } = createFakes();

    expect(structure.read("/nowhere")).toEqual(Repository.empty);
    expect(findings.measuredOf("/nowhere", "crap")).toBeNull();
    expect(structure.responsibilityKinds("/nowhere")).toEqual({
      registered: false,
      kinds: {},
    });
    expect(structure.discard("/repo", "python")).toBe(false);

    structure.save("/repo", "python", repositoryOf({ "a.py": "h" }, []));
    structure.save(
      "/repo",
      "kotlin",
      repositoryOf({ "B.kt": "h" }, [], "kotlin"),
    );

    expect(structure.discard("/repo", "python")).toBe(true);
    expect(structure.scans.has(cachePath("/repo", "kotlin"))).toBe(true);
    expect(structure.discard("/repo", "python")).toBe(false);
  });
});
