import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import {
  APP_CONFIG,
  type FakeOptions,
  fakeIo,
  PYTHON,
  ROOT,
  scanJson,
} from "./scan-helpers.js";

const COMMIT = "abc123";
const PY_CACHE = `${ROOT}/.recognizer/cache/scan.python.json`;
const CONFIG = `${ROOT}/.recognizer/config.yaml`;
const LOG = `${ROOT}/.recognizer/cache/log`;
const REFERENCE =
  'describer:\n  command: [recognizer-describe-claude, --model, "{model}", "{request}"]\n  version: "v1"\n';
const CUSTOM =
  'describer:\n  command: [custom-describer, "{module}"]\n  version: "v1"\n';

function current(): string {
  return scanJson(2, 1, {
    commit: COMMIT,
    modified: false,
    files: [
      { path: "m0.py", hash: "0".repeat(64) },
      { path: "m1.py", hash: "1".repeat(64) },
    ],
  });
}

function setup(config: string, more: FakeOptions = {}): FakeOptions {
  return {
    commit: COMMIT,
    files: {
      [`${ROOT}/a.py`]: "",
      [`${ROOT}/m0.py`]: "one",
      [`${ROOT}/m1.py`]: "two",
      [PY_CACHE]: current(),
      [CONFIG]: config,
    },
    scanners: { [PYTHON]: { output: current() } },
    ...more,
  };
}

async function scan(options: FakeOptions, ...args: string[]) {
  const fake = fakeIo(options);
  const code = await run(["scan", ROOT, ...args], fake.io);

  return { code, fake, out: fake.out(), err: fake.err() };
}

function events(out: string): Record<string, unknown>[] {
  return out
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line));
}

function records(fake: ReturnType<typeof fakeIo>) {
  return [...fake.files.keys()]
    .filter((key) => key.startsWith(`${LOG}/`))
    .map((key) => JSON.parse(fake.files.get(key) as string));
}

describe("scan preflight: the early stage", () => {
  it("is a no-commit gap with --sense", async () => {
    const options = { ...setup(""), commit: undefined };
    const { code, out } = await scan(options, "--sense", "crap", "--json");
    const gaps = events(out).find(
      (one) => one.event === "preflight" && one.gaps,
    );

    expect(code).toBe(4);
    expect(gaps).toMatchObject({
      gaps: [
        {
          id: "no-commit",
          needs: ["crap"],
          fix: { kind: "outside", command: null },
        },
      ],
    });
  });

  it("is no gap with --describe alone and no commit", async () => {
    const options = {
      ...setup(REFERENCE),
      commit: undefined,
      programs: {
        "recognizer-describe-claude": () => ({ stdout: "a line\n" }),
      },
    };
    const { code } = await scan(options, "--describe");

    expect(code).toBe(0);
  });

  it("refuses with exit 4, a line per gap on stderr and the skipped phases recorded", async () => {
    const options = { ...setup(REFERENCE), commit: undefined };
    const json = await scan(options, "--describe", "--sense", "crap", "--json");
    const [record] = records(json.fake);
    const all = events(json.out);
    const plain = await scan(options, "--sense", "crap");

    expect(json.code).toBe(4);
    expect(all.map((one) => [one.event, one.state ?? null])).toEqual([
      ["preflight", "run"],
      ["preflight", "gaps"],
      ["summary", null],
    ]);
    expect(all[2]).toMatchObject({
      exit: 4,
      skipped: [
        { phase: "describe", reason: "preflight found 1 gap" },
        { phase: "sense", reason: "preflight found 1 gap" },
      ],
    });
    expect(record.skipped).toEqual(all[2]?.skipped);
    expect(record.outcome).toBe("failed");
    expect(plain.err).toContain(
      "the folder has no git commit (crap): make the first commit (git add the files, then git commit)",
    );
  });
});

describe("scan preflight: skipped phases", () => {
  it("records the describe per-language skip", async () => {
    const options = setup(CUSTOM, {
      files: {
        [`${ROOT}/a.py`]: "",
        [CONFIG]: CUSTOM,
        [`${APP_CONFIG}/config.json`]: `${JSON.stringify({ describing: { model: "sonnet", batch_size: 4 } })}\n`,
      },
      scanners: { [PYTHON]: { status: 1, stderr: "boom" } },
      programs: { "custom-describer": () => ({ stdout: "a line\n" }) },
    });
    const { fake, out } = await scan(options, "--describe", "--json");
    const [record] = records(fake);

    expect(events(out).at(-1)).toMatchObject({
      skipped: [{ phase: "describe", reason: "no scan for python" }],
    });
    expect(record.skipped).toEqual([
      { phase: "describe", reason: "no scan for python" },
    ]);
  });
});
