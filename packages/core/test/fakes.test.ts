import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createFakes } from "./fakes/container.js";
import { cachePath } from "./fakes/fake-store.js";

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
      "clock",
      "confirm",
      "describer",
      "git",
      "process",
      "scanners",
      "sensors",
      "store",
    ]);
    expect(fakeKeys).toEqual(ports);
    expect(
      readdirSync(join(here, "fakes")).filter((name) =>
        name.startsWith("fake-"),
      ),
    ).toHaveLength(ports.length);
  });

  it("the store lock refuses a second acquire and release is idempotent", () => {
    const { store } = createFakes();
    const first = store.acquireLock("/repo", { sensors: [], describe: false });

    expect(first.ok).toBe(true);
    expect(
      store.acquireLock("/repo", { sensors: [], describe: false }).ok,
    ).toBe(false);

    if (first.ok) {
      first.lock.release();
      first.lock.release();
    }

    expect(
      store.acquireLock("/repo", { sensors: [], describe: false }).ok,
    ).toBe(true);
  });

  it("git returns the commit it was given and the dirty flag", () => {
    const { git } = createFakes("abc123");

    expect(git.commit()).toBe("abc123");
    expect(git.dirty()).toBe(false);

    git.modified = true;

    expect(git.dirty()).toBe(true);
  });

  it("scanners report the counts they were told and remove nothing themselves", async () => {
    const fakes = createFakes();

    fakes.scanners.languages.set("alpha", {
      modules: 4,
      edges: 7,
      fails: false,
    });
    fakes.store.files.set(cachePath("/repo", "alpha"), "old");

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

    expect(fakes.store.files.has(cachePath("/repo", "alpha"))).toBe(true);
  });
});
