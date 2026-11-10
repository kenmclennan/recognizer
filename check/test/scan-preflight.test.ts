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
