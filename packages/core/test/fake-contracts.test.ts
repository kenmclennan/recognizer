import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import {
  FAKE_CONTRACTS,
  FAKE_DIRECTORIES,
  type FakeContract,
} from "./fake-contracts.js";
import { checkContracts } from "./fake-contracts-check.js";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, "../../..");

function tree(files: Record<string, string>): string {
  const root = makeTempDir("fake-contracts-");

  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }

  return root;
}

const DIRECTORIES = ["fakes"];

function entry(name: string, proof: string): FakeContract {
  return {
    fake: `fakes/fake-${name}.ts`,
    fakeName: `Fake${name}`,
    adapter: `adapters/${name}-adapter.ts`,
    adapterName: `${name}Adapter`,
    proofs: [proof],
  };
}

describe("fake contracts", () => {
  it("a registry entry whose proof file lacks an import fails and names the entry", () => {
    const root = tree({
      "fakes/fake-one.ts": "",
      "proof.test.ts": 'import { Fakeone } from "./fakes/fake-one.js";',
    });
    const report = checkContracts({
      root,
      registry: [entry("one", "proof.test.ts")],
      baseline: "",
      directories: DIRECTORIES,
    });

    expect(report.badProofs).toHaveLength(1);
    expect(report.badProofs[0]).toContain("Fakeone");
  });

  it("a registry entry whose proof file is missing fails", () => {
    const root = tree({ "fakes/fake-one.ts": "" });
    const report = checkContracts({
      root,
      registry: [entry("one", "missing.test.ts")],
      baseline: "",
      directories: DIRECTORIES,
    });

    expect(report.badProofs[0]).toContain("does not exist");
  });

  it("a fake in neither the registry nor the baseline fails and names it", () => {
    const root = tree({ "fakes/fake-lonely.ts": "" });
    const report = checkContracts({
      root,
      registry: [],
      baseline: "",
      directories: DIRECTORIES,
    });

    expect(report.found).toEqual(["fakes/fake-lonely.ts"]);
    expect(report.unlisted).toEqual(["fakes/fake-lonely.ts"]);
  });

  it("a stale baseline line fails", () => {
    const root = tree({ "fakes/fake-here.ts": "" });
    const report = checkContracts({
      root,
      registry: [],
      baseline: "fakes/fake-here.ts\nfakes/fake-gone.ts\n",
      directories: DIRECTORIES,
    });

    expect(report.stale).toEqual(["fakes/fake-gone.ts"]);
    expect(report.unlisted).toEqual([]);
  });

  it("a baseline line for a fake that is now registered is stale", () => {
    const root = tree({
      "fakes/fake-one.ts": "",
      "proof.test.ts":
        'import { Fakeone } from "./fakes/fake-one.js"; import { oneAdapter } from "./adapters/one-adapter.js";',
    });
    const report = checkContracts({
      root,
      registry: [entry("one", "proof.test.ts")],
      baseline: "fakes/fake-one.ts\n",
      directories: DIRECTORIES,
    });

    expect(report.stale).toEqual(["fakes/fake-one.ts"]);
    expect(report.badProofs).toEqual([]);
  });

  it("the mixed case reports the unlisted fake and the stale line and passes the other two", () => {
    const root = tree({
      "fakes/fake-reg.ts": "",
      "fakes/fake-base.ts": "",
      "fakes/fake-unlisted.ts": "",
      "proof.test.ts":
        'import { Fakereg } from "./fakes/fake-reg.js"; import { regAdapter } from "./adapters/reg-adapter.js";',
    });
    const report = checkContracts({
      root,
      registry: [entry("reg", "proof.test.ts")],
      baseline: "fakes/fake-base.ts\nfakes/fake-old.ts\n",
      directories: DIRECTORIES,
    });

    expect(report.unlisted).toEqual(["fakes/fake-unlisted.ts"]);
    expect(report.stale).toEqual(["fakes/fake-old.ts"]);
    expect(report.badProofs).toEqual([]);
  });

  it("the real tree matches its registry and baseline", () => {
    const report = checkContracts({
      root: REPO,
      registry: FAKE_CONTRACTS,
      baseline: readFileSync(join(here, "fake-contracts-baseline.txt"), "utf8"),
      directories: FAKE_DIRECTORIES,
    });

    expect(report.badProofs).toEqual([]);
    expect(report.unlisted).toEqual([]);
    expect(report.stale).toEqual([]);
    expect(report.registered.map((path) => path.split("/").pop())).toEqual([
      "fake-git.ts",
      "fake-clock.ts",
      "fake-process.ts",
      "fake-repository-files.ts",
      "fake-run-log-repository.ts",
      "fake-scratch.ts",
      "fake-scan-cache.ts",
      "fake-plugin-registrations.ts",
      "fake-io.ts",
    ]);
    expect(report.baselined.length).toBe(41);
    expect(report.baselined.length + report.registered.length).toBe(
      report.found.length,
    );
    expect(report.found.length).toBe(50);
  });
});
