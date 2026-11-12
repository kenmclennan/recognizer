import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { validateFindings } from "../src/findings-document.js";
import { runScanSync } from "../src/scan-command.js";
import { REPO } from "./helpers.js";
import { fakeIo, PYTHON, ROOT, scanJson } from "./scan-helpers.js";

const COMMIT = "abc123";
const HASH = "0".repeat(64);
const SOURCE = readFileSync(
  join(REPO, "fixtures/duplication/sample/app/pricing.py"),
  "utf8",
);
const CACHE = `${ROOT}/.recognizer/cache/scan.python.json`;
const STRUCTURE = `${ROOT}/.recognizer/cache/findings/structure.json`;
const LEFTOVER = `${ROOT}/.recognizer/cache/findings/duplication.json`;

function scanDocument(): string {
  return scanJson(0, 0, {
    commit: COMMIT,
    modified: false,
    files: [{ path: "app/pricing.py", hash: HASH }],
    modules: [
      { id: "app/pricing.py", language: "python", kind: "module", members: [] },
    ],
  });
}

function repository(extra: Record<string, string> = {}) {
  return fakeIo({
    commit: COMMIT,
    files: {
      [`${ROOT}/app/pricing.py`]: SOURCE,
      [CACHE]: scanDocument(),
      ...extra,
    },
    scanners: { [PYTHON]: { output: scanDocument() } },
  });
}

function structureOf(fake: ReturnType<typeof repository>) {
  return validateFindings(JSON.parse(fake.files.get(STRUCTURE) as string), {
    name: "structure",
  });
}

describe("the scan driver and duplication", () => {
  it("measures duplication on a scan and records the settings", async () => {
    const fake = repository({ [LEFTOVER]: "{}" });

    const code = await run(["scan", ROOT], fake.io);

    expect(fake.err()).toBe("duplication: 1 files parsed, 0 reused\n");
    expect(code).toBe(0);

    const document = structureOf(fake);
    const found = document.findings.filter((one) => one.kind === "duplication");

    expect(found.map((one) => one.id)).toEqual([
      "duplication:app/pricing.py::sum_with_levy|app/pricing.py::total_with_tax",
    ]);
    expect(document.settings.duplication).toEqual({
      threshold: 0.82,
      min_lines: 4,
      pair_min_lines: 6,
      min_nodes: 20,
    });
    expect(fake.files.has(LEFTOVER)).toBe(false);
  });

  it("measures nothing and records no settings when duplication is off", async () => {
    const fake = repository({
      [`${ROOT}/.recognizer/config.yaml`]:
        "sensors:\n  structure:\n    duplication: false\n",
    });

    expect(await run(["scan", ROOT], fake.io)).toBe(0);

    const document = structureOf(fake);

    expect(
      document.findings.filter((one) => one.kind === "duplication"),
    ).toEqual([]);
    expect(document.settings.duplication).toBeUndefined();
  });

  it("writes no structure document when the structure sensor is off", async () => {
    const fake = repository({
      [`${ROOT}/.recognizer/config.yaml`]: "sensors:\n  structure: off\n",
    });

    expect(await run(["scan", ROOT], fake.io)).toBe(0);
    expect(fake.files.has(STRUCTURE)).toBe(false);
  });

  it("refuses --sense duplication and names the structure sensor", async () => {
    const fake = repository();

    expect(await run(["scan", ROOT, "--sense", "duplication"], fake.io)).toBe(
      2,
    );
    expect(fake.err()).toContain(
      "duplication is part of the structure sensor and runs with every scan",
    );
  });

  it("keeps the stored duplication when the synchronous scan carries it forward", async () => {
    const first = repository();

    await run(["scan", ROOT], first.io);

    const stored = first.files.get(STRUCTURE) as string;
    const fake = repository({ [STRUCTURE]: stored });

    expect(runScanSync([ROOT, "--extract"], fake.io, "all")).toBe(0);

    const document = structureOf(fake);

    expect(
      document.findings.filter((one) => one.kind === "duplication"),
    ).toHaveLength(1);
    expect(document.settings.duplication).toBeDefined();
  });
});
