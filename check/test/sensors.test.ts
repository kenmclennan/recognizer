import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../scripts/temp-dirs.mjs";
import { run } from "../src/cli.js";
import { capture, REPO } from "./helpers.js";
import {
  type Fake,
  type FakeOptions,
  fakeIo,
  type Program,
  PYTHON,
  ROOT,
} from "./scan-helpers.js";

const COMMIT = "abc123";
const read = (path: string) => readFileSync(join(REPO, path), "utf8");
const checkScan = JSON.parse(read("fixtures/check/scan.json"));
const CONFIG = `${ROOT}/.recognizer/config.yaml`;
const STRUCTURE = `${ROOT}/.recognizer/cache/findings/structure.json`;
const FAKE = `${ROOT}/.recognizer/cache/findings/fake-sensor.json`;
const BASELINE = `${ROOT}/.recognizer/baselines/violations.json`;

function cached(commit = COMMIT) {
  return JSON.stringify({ ...checkScan, commit, modified: false, files: [] });
}

function fakeDocument(changes: Record<string, unknown> = {}) {
  return JSON.stringify({
    findings_version: 1,
    sensor: { name: "fake-sensor", version: "1" },
    commit: COMMIT,
    modified: false,
    settings: {},
    findings: [
      {
        id: "fake-violation:shop/main.py",
        kind: "fake-violation",
        severity: "violation",
        principle: "fake-principle",
        summary: "the fake sensor objects",
        evidence: { modules: ["shop/main.py"] },
      },
    ],
    ...changes,
  });
}

function sensor(content: string | null, status = 0): Program {
  return (args, files) => {
    if (content !== null) {
      files.set(args[args.length - 1] as string, content);
    }

    return status === 0 ? undefined : { status, stderr: "broke" };
  };
}

function setup(yaml: string | null, options: FakeOptions = {}): Fake {
  return fakeIo({
    commit: COMMIT,
    ...options,
    files: {
      [`${ROOT}/shop/a.py`]: "",
      [`${ROOT}/.recognizer/cache/scan.python.json`]: cached(),
      [`${ROOT}/.recognizer/policy.yaml`]: read(
        "fixtures/check/.recognizer/policy.yaml",
      ),
      [BASELINE]: read("fixtures/check/.recognizer/baselines/violations.json"),
      ...(yaml === null ? {} : { [CONFIG]: yaml }),
      ...options.files,
    },
  });
}

const REGISTER =
  'sensors:\n  fake-sensor:\n    command: [fake-sensor, "{commit}", "{output}"]\n';

function check(fake: Fake, ...argv: string[]) {
  const code = run(["check", "--repository", ROOT, ...argv], fake.io);

  return { code, out: fake.out(), err: fake.err() };
}

describe("check running a registered sensor", () => {
  it("puts the sensor's violation in the union and through the baseline", () => {
    const fake = setup(REGISTER, {
      programs: { "fake-sensor": sensor(fakeDocument()) },
    });
    const { code, out } = check(fake, "--json");
    const report = JSON.parse(out);

    expect(code).toBe(1);
    expect(report.violations).toHaveLength(6);
    expect(report.new).toHaveLength(5);
    expect(
      report.new.map((v: { finding_id?: string }) => v.finding_id),
    ).toContain("fake-violation:shop/main.py");
    expect(
      report.sensors.map((s: { name: string; status: string }) => [
        s.name,
        s.status,
      ]),
    ).toEqual([
      ["fake-sensor", "ran"],
      ["structure", "ran"],
    ]);
    expect(fake.files.has(FAKE)).toBe(true);
  });

  it("accepts the sensor's violation once the baseline lists it by id", () => {
    const yaml = `${REGISTER}  structure:\n    hub_threshold: 10\n`;
    const baseline = JSON.stringify({
      schema_version: 1,
      violations: [{ id: "fake-violation:shop/main.py" }],
    });
    const fake = setup(yaml, {
      programs: { "fake-sensor": sensor(fakeDocument()) },
      files: { [BASELINE]: `${baseline}\n` },
    });
    const report = JSON.parse(check(fake, "--json").out);

    expect(
      report.new.map((v: { finding_id?: string }) => v.finding_id),
    ).not.toContain("fake-violation:shop/main.py");
  });

  it.each([
    ["exits non-zero", sensor(null, 3)],
    ["writes nothing", sensor(null)],
    ["writes invalid JSON", sensor("{")],
    [
      "writes another sensor's name",
      sensor(fakeDocument({ sensor: { name: "someone-else", version: "1" } })),
    ],
    ["writes the wrong commit", sensor(fakeDocument({ commit: "other" }))],
    [
      "writes duplicate ids",
      sensor(
        JSON.stringify({
          ...JSON.parse(fakeDocument()),
          findings: [
            ...JSON.parse(fakeDocument()).findings,
            ...JSON.parse(fakeDocument()).findings,
          ],
        }),
      ),
    ],
  ])(
    "reports a sensor that %s by name, leaves no file and exits 1",
    (_, program) => {
      const fake = setup(REGISTER, { programs: { "fake-sensor": program } });
      const { code, err, out } = check(fake, "--json");

      expect(code).toBe(1);
      expect(err).toContain("failed fake-sensor:");
      expect(fake.files.has(FAKE)).toBe(false);
      expect(JSON.parse(out).sensors[0]).toMatchObject({
        name: "fake-sensor",
        status: "failed",
      });
    },
  );

  it("fails the run for a missing program", () => {
    const fake = setup(REGISTER);
    const { code, err } = check(fake);

    expect(code).toBe(1);
    expect(err).toContain("failed fake-sensor:");
  });

  it("ignores a leftover file from another commit and reports it stale", () => {
    const fake = setup(null, {
      files: { [FAKE]: fakeDocument({ commit: "old" }) },
    });
    const { code, err, out } = check(fake, "--json");
    const report = JSON.parse(out);

    expect(err).toContain("stale fake-sensor");
    expect(report.violations).toHaveLength(5);
    expect(report.sensors).toContainEqual({
      name: "fake-sensor",
      status: "stale",
    });
    expect(code).toBe(1);
  });

  it("does not let a stale file change the exit code", () => {
    const fake = setup(null, {
      files: {
        [FAKE]: fakeDocument({ commit: "old" }),
        [BASELINE]: JSON.stringify({
          schema_version: 1,
          violations: JSON.parse(read("fixtures/check/expected.json"))
            .violations.map(
              ({
                from,
                to,
                kind,
              }: {
                from: string;
                to: string;
                kind: string;
              }) => ({ from, to, kind }),
            )
            .sort(
              (
                a: { from: string; to: string },
                b: { from: string; to: string },
              ) =>
                a.from === b.from
                  ? a.to < b.to
                    ? -1
                    : 1
                  : a.from < b.from
                    ? -1
                    : 1,
            ),
        }),
      },
    });

    expect(check(fake).code).toBe(0);
  });

  it("reads a baseline mixing an identity entry and an id entry", () => {
    const baseline = JSON.stringify({
      schema_version: 1,
      violations: [
        {
          from: "shop/domain/order.py",
          to: "shop/adapters/memory_store.py",
          kind: "depends",
        },
        { id: "fake-violation:gone" },
      ],
    });
    const fake = setup(REGISTER, {
      programs: { "fake-sensor": sensor(fakeDocument()) },
      files: { [BASELINE]: `${baseline}\n` },
    });
    const report = JSON.parse(check(fake, "--json").out);

    expect(report.fixed).toEqual([{ id: "fake-violation:gone" }]);
    expect(report.new).toHaveLength(5);
    expect(
      report.new.map(
        (v: { finding_id?: string }) => v.finding_id ?? "structure",
      ),
    ).toContain("fake-violation:shop/main.py");
  });
});

describe("check running the structure sensor", () => {
  it("writes structure.json through a temp file and a rename, recording the settings", () => {
    const fake = setup(null);
    const { err, out } = check(fake);
    const document = JSON.parse(fake.files.get(STRUCTURE) as string);

    expect(fake.renames).toContainEqual({
      from: `${STRUCTURE}.tmp`,
      to: STRUCTURE,
    });
    expect(fake.files.has(`${STRUCTURE}.tmp`)).toBe(false);
    expect(document.settings).toEqual({
      hub_threshold: 10,
      warnings: { cycle: true, hub: true },
    });
    expect(document.commit).toBe(COMMIT);
    expect(out.split("\n")[0]).toBe(
      "sensor structure: hub_threshold 10, cycle on, hub on",
    );
    expect(err).toBe("");
  });

  it("writes no file and removes an old one when structure is off", () => {
    const fake = setup("sensors:\n  structure: off\n", {
      files: { [STRUCTURE]: "{}" },
    });
    const { out } = check(fake, "--json");
    const report = JSON.parse(out);

    expect(fake.files.has(STRUCTURE)).toBe(false);
    expect(report.sensors).toEqual([{ name: "structure", status: "off" }]);
    expect(report.violations).toEqual([]);
    expect(report.thresholds).toBeUndefined();
  });

  it("produces no hub warning when the hub switch is off", () => {
    const fake = setup(
      "sensors:\n  structure:\n    hub_threshold: 1\n    warnings:\n      hub: false\n",
    );
    const report = JSON.parse(check(fake, "--json").out);

    expect(report.warnings.some((w: { id: string }) => w.id === "hub")).toBe(
      false,
    );
  });

  it("reads hub_threshold from the config as --hub-threshold does", () => {
    const fromConfig = JSON.parse(
      check(setup("sensors:\n  structure:\n    hub_threshold: 2\n"), "--json")
        .out,
    );
    const fromFlag = JSON.parse(
      check(setup(null), "--hub-threshold", "2", "--json").out,
    );

    expect(fromConfig.warnings).toEqual(fromFlag.warnings);
    expect(fromConfig.thresholds).toEqual({ hub: 2 });
  });

  it("lets the flag beat the config and records the flag's value", () => {
    const fake = setup("sensors:\n  structure:\n    hub_threshold: 2\n");
    const { out } = check(fake, "--hub-threshold", "5");

    expect(
      JSON.parse(fake.files.get(STRUCTURE) as string).settings.hub_threshold,
    ).toBe(5);
    expect(out.split("\n")[0]).toContain("hub_threshold 5");
  });

  it("leaves no structure.json and exits 1 when the rename fails", () => {
    const fake = setup(null);
    const original = fake.io.rename;

    fake.io.rename = (from, to) => {
      if (to === STRUCTURE) {
        throw new Error("disk full");
      }

      original(from, to);
    };

    const { code, err } = check(fake);

    expect(code).toBe(1);
    expect(err).toContain("failed structure: disk full");
    expect(fake.files.has(STRUCTURE)).toBe(false);
    expect(fake.files.has(`${STRUCTURE}.tmp`)).toBe(false);
  });

  it("writes nothing in --scan replay", () => {
    const fake = fakeIo({ files: { "x.json": JSON.stringify(checkScan) } });

    run(["check", "--scan", "x.json"], fake.io);

    expect(fake.writes).toEqual([]);
  });
});

describe("show and modules read the findings files", () => {
  const MODULE = "shop/domain/order.py";

  function show(fake: Fake, ...extra: string[]) {
    const code = run(
      ["show", MODULE, "--repository", ROOT, "--json", ...extra],
      fake.io,
    );

    return { code, out: fake.out(), err: fake.err() };
  }

  it("writes structure.json when it is missing", () => {
    const fake = setup(null);

    show(fake);

    expect(fake.files.has(STRUCTURE)).toBe(true);
  });

  it("writes nothing when a fresh file already exists", () => {
    const fake = setup(null);

    show(fake);

    const before = fake.writes.length;

    show(fake);

    expect(fake.writes.length).toBe(before);
  });

  it("regenerates a file for another commit", () => {
    const stale = JSON.stringify({
      findings_version: 1,
      sensor: { name: "structure", version: "1" },
      commit: "old",
      modified: false,
      settings: { hub_threshold: 10, warnings: { cycle: true, hub: true } },
      findings: [],
    });
    const fake = setup(null, { files: { [STRUCTURE]: stale } });

    show(fake);

    expect(JSON.parse(fake.files.get(STRUCTURE) as string).commit).toBe(COMMIT);
  });

  it("regenerates when the config's settings differ from the file's", () => {
    const fake = setup(null);

    show(fake);

    const withConfig = setup("sensors:\n  structure:\n    hub_threshold: 4\n", {
      files: { [STRUCTURE]: fake.files.get(STRUCTURE) as string },
    });

    show(withConfig);

    expect(
      JSON.parse(withConfig.files.get(STRUCTURE) as string).settings
        .hub_threshold,
    ).toBe(4);
  });

  it("regenerates every time on a modified tree", () => {
    const fake = setup(null, {
      status: " M shop/a.py\n",
      scanners: {
        [PYTHON]: {
          output: JSON.stringify({
            ...checkScan,
            commit: COMMIT,
            modified: true,
            files: [],
          }),
        },
      },
    });

    show(fake);
    show(fake);

    expect(
      fake.writes.filter((path) => path.endsWith("structure.json.tmp")).length,
    ).toBe(2);
  });

  it("does not write under --hub-threshold", () => {
    const fake = setup(null);

    show(fake, "--hub-threshold", "2");

    expect(fake.files.has(STRUCTURE)).toBe(false);
  });

  it("reads nothing for structure when it is off", () => {
    const fake = setup("sensors:\n  structure: off\n", {
      files: { [STRUCTURE]: "{}" },
    });
    const { out } = show(fake);

    expect(JSON.parse(out).findings ?? []).toEqual([]);
    expect(fake.files.get(STRUCTURE)).toBe("{}");
  });

  it("ignores a registered sensor's file from another commit with a stale line", () => {
    const fake = setup(null, {
      files: { [FAKE]: fakeDocument({ commit: "old" }) },
    });
    const { err } = show(fake);

    expect(err).toContain("stale fake-sensor");
  });

  it("includes a registered sensor's current findings and never runs it", () => {
    const fake = setup(REGISTER, {
      programs: { "fake-sensor": sensor(fakeDocument()) },
      files: {
        [FAKE]: fakeDocument({
          findings: [
            {
              id: "x:1",
              kind: "x",
              severity: "warning",
              principle: "p",
              summary: "from the file",
              evidence: { modules: [MODULE] },
            },
          ],
        }),
      },
    });
    const { out } = show(fake);

    expect(out).toContain("from the file");
    expect(fake.calls.some((call) => call.command === "fake-sensor")).toBe(
      false,
    );
  });

  it("reports an invalid registered file as invalid", () => {
    const fake = setup(null, { files: { [FAKE]: "{}" } });

    expect(show(fake).err).toContain("invalid fake-sensor:");
  });
});

describe("check running a registered sensor as a real process", () => {
  it("writes the sensor's findings file with the commit it was given", () => {
    const root = makeTempDir("recognizer-sensor-");

    cpSync(join(REPO, "fixtures/python/sample"), root, { recursive: true });

    const git = (...args: string[]) =>
      execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });

    git("init", "-q");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "t");
    git("add", ".");
    git("commit", "-q", "-m", "sample");

    const script = join(REPO, "check/test/fixtures/fake-sensor.mjs");

    mkdirSync(join(root, ".recognizer/cache"), { recursive: true });
    writeFileSync(
      join(root, ".recognizer/cache/scan.python.json"),
      cached(git("rev-parse", "HEAD").trim()),
    );
    writeFileSync(
      join(root, ".recognizer/config.yaml"),
      `sensors:\n  fake-sensor:\n    command: ["node", ${JSON.stringify(script)}, "{repository}", "{commit}", "{output}"]\n`,
    );

    const out = capture();
    const code = run(["check", "--repository", root, "--json"], out.io);
    const file = join(root, ".recognizer/cache/findings/fake-sensor.json");
    const document = JSON.parse(readFileSync(file, "utf8"));

    expect(out.err()).toBe("");
    expect(document.commit).toBe(git("rev-parse", "HEAD").trim());
    expect(JSON.parse(out.out()).violations).toHaveLength(1);
    expect(code).toBe(1);
  });
});
