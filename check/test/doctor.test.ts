import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/cli.js";
import { unsetValue } from "../src/config-edit.js";
import { loadKeys } from "../src/config-keys.js";
import { RETIRED_KEYS } from "../src/config-retired.js";
import { fakeIo, ROOT, scanJson } from "./scan-helpers.js";

beforeEach(() => {
  vi.spyOn(process, "cwd").mockReturnValue(ROOT);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const COMMIT = "abc123";
const CACHE = `${ROOT}/.recognizer/cache/scan.python.json`;
const READY_SENSOR =
  "sensors:\n  mine:\n    command: [recognizer-sensors, mine]\n";
const POLICY = 'components:\n  core: "m*.py"\n';

interface Setup {
  config?: string | null;
  policy?: string | null;
  cache?: string | null;
  status?: string;
  scanner?: boolean;
  env?: Record<string, string>;
  files?: Record<string, string>;
  gap?: boolean;
}

function setup(options: Setup = {}) {
  const files: Record<string, string> = {
    [`${ROOT}/m0.py`]: "",
    ...(options.config === null || options.config === undefined
      ? {}
      : { [`${ROOT}/.recognizer/config.yaml`]: options.config }),
    ...(options.policy === null || options.policy === undefined
      ? {}
      : { [`${ROOT}/.recognizer/policy.yaml`]: options.policy }),
    ...(options.cache === null || options.cache === undefined
      ? {}
      : { [CACHE]: options.cache }),
    ...(options.scanner === false ? {} : { "/bin/recognizer-scan-python": "" }),
    ...options.files,
  };

  return fakeIo({
    commit: COMMIT,
    status: options.status,
    files,
    env: { PATH: "/usr/local/bin:/bin", ...options.env },
    sensorsPreflight: options.gap
      ? {
          run: () => ({
            stdout: `${JSON.stringify({ gaps: [{ code: "no-coverage", suite: null, line: "mine has no coverage" }] })}\n`,
          }),
        }
      : undefined,
  });
}

function doctor(fake: ReturnType<typeof setup>, ...args: string[]) {
  const status = run(["doctor", ...args], fake.io);

  return { status, out: fake.out(), err: fake.err() };
}

function json(fake: ReturnType<typeof setup>, ...args: string[]) {
  const result = doctor(fake, ...args, "--json");

  return { ...result, report: JSON.parse(result.out) };
}

const current = scanJson(2, 1, { commit: COMMIT }, "  ");
const clean = {
  config: READY_SENSOR,
  policy: POLICY,
  cache: current,
  env: { PATH: "/bin" },
};

function codes(report: {
  areas: { name: string; problems: { code: string }[] }[];
}) {
  return report.areas.flatMap((area) =>
    area.problems.map((problem) => `${area.name}:${problem.code}`),
  );
}

describe("doctor: a clean repository", () => {
  it("prints No problems last and exits 0", () => {
    const result = doctor(setup(clean), ROOT);

    expect(result.status).toBe(0);
    expect(result.out.trimEnd().split("\n").pop()).toBe("No problems");
  });

  it("gives the whole clean --json document", () => {
    const result = json(setup(clean), ROOT);

    expect(result.status).toBe(0);
    expect(result.report).toEqual({
      repository: ROOT,
      ok: true,
      problems: 0,
      areas: [
        { name: "config", skipped: null, problems: [] },
        { name: "policy", skipped: null, problems: [] },
        { name: "scanners", skipped: null, problems: [] },
        { name: "sensors", skipped: null, problems: [] },
      ],
    });
    expect(result.out).toBe(`${JSON.stringify(result.report, null, 2)}\n`);
  });

  it("checks a repository with no config, no policy and no sensors", () => {
    const result = doctor(setup({ env: { PATH: "/bin" } }), ROOT);

    expect(result.status).toBe(0);
    expect(result.out).toBe("No problems\n");
  });
});

describe("retired keys are unsettable", () => {
  const published = loadKeys(fakeIo().io, ROOT);
  const sampleFor = (path: string[]) =>
    path.length === 1
      ? "overlays:\n  crap:\n    command: [x]\n"
      : `sensors:\n  structure:\n${
          path.length === 4
            ? `    warnings:\n      ${path[3]}: true\n`
            : `    ${path[2]}: 1\n`
        }`;

  it.each(RETIRED_KEYS.map((retired) => [retired.path.join(".")]))(
    "unsets %s and doctor then reports none",
    (key) => {
      const path = key.split(".");
      const text = sampleFor(path);

      const outcome = unsetValue(text, published, key);

      expect(outcome.status).toBe("ok");

      const after = (outcome as { text: string }).text;

      expect(after).not.toMatch(path[path.length - 1] as string);

      const result = json(setup({ config: after, env: { PATH: "/bin" } }));

      expect(codes(result.report)).not.toContain("config:config-retired");
    },
  );

  it("reports a retired key not in the document as absent", () => {
    expect(
      unsetValue(
        "sensors:\n  crap:\n    threshold: 1\n",
        published,
        "overlays",
      ),
    ).toEqual({ status: "absent" });
    expect(
      unsetValue(
        "sensors:\n  structure:\n    warnings:\n      cycle: true\n",
        published,
        "sensors.structure.hub_threshold",
      ),
    ).toEqual({ status: "absent" });
  });

  it("still refuses an unknown key", () => {
    expect(
      unsetValue(
        "sensors:\n  crap:\n",
        published,
        "sensors.structure.nonsense",
      ),
    ).toMatchObject({ status: "refused" });
  });
});

describe("doctor: usage", () => {
  it.each([
    [["doctor", "a", "b"]],
    [["doctor", "--bogus"]],
    [["doctor", "/nowhere"]],
  ])("%j exits 2", (argv) => {
    const fake = setup(clean);

    expect(run(argv, fake.io)).toBe(2);
  });
});
