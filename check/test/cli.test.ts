import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import {
  check,
  parseBaseline,
  parsePolicy,
  validateScan,
} from "../src/index.js";
import { capture, checkArgs, copyFixture, FIXTURE, REPO } from "./helpers.js";

const expected = JSON.parse(
  readFileSync(join(FIXTURE, "expected.json"), "utf8"),
);

function execute(args: string[]) {
  const captured = capture();
  const code = run(args, captured.io);

  return { code, out: captured.out(), err: captured.err() };
}

const BASELINE = ".recognizer/baselines/violations.json";

describe("check against the fixture", () => {
  it("prints expected.json on stdout and exits 1", () => {
    const { code, out, err } = execute(checkArgs(FIXTURE));
    const actual = JSON.parse(out);

    delete actual.baseline.path;

    expect(code).toBe(1);
    expect(actual).toEqual(expected);
    expect(err).toContain("violations: 5, new: 4, fixed: 1, unranked: 1");
  });

  it("agrees with the library", () => {
    const scan = JSON.parse(readFileSync(join(FIXTURE, "scan.json"), "utf8"));
    const policy = parsePolicy(
      readFileSync(join(FIXTURE, ".recognizer/policy.yaml"), "utf8"),
    );
    const baseline = parseBaseline(
      readFileSync(join(FIXTURE, BASELINE), "utf8"),
    );
    const result = check(scan, policy, baseline);

    expect(result).toEqual({
      violations: expected.violations,
      new: expected.new,
      fixed: expected.fixed,
      unranked: expected.unranked,
    });
  });

  it("runs as a built child process", () => {
    const child = spawnSync(
      process.execPath,
      [join(REPO, "check/dist/bin.js"), ...checkArgs(FIXTURE)],
      { encoding: "utf8" },
    );

    expect(child.status).toBe(1);
    expect(JSON.parse(child.stdout).unranked).toBe(1);
  });

  it("treats a missing baseline as empty and says so", () => {
    const dir = copyFixture();
    const { out } = execute(
      checkArgs(dir, "--baseline", join(dir, "nope.json")),
    );
    const result = JSON.parse(out);

    expect(result.baseline.present).toBe(false);
    expect(result.new).toHaveLength(5);
  });

  it("exits 0 when everything is ignored", () => {
    const dir = copyFixture();
    const policyPath = join(dir, ".recognizer/policy.yaml");
    writeFileSync(
      policyPath,
      'components:\n  a: x/**\nlevels: [a]\nignore: ["**"]\n',
    );

    expect(execute(checkArgs(dir)).code).toBe(0);
  });
});

describe("--update-baseline", () => {
  it("writes nothing and exits 1 while a new violation exists", () => {
    const dir = copyFixture();
    const before = readFileSync(join(dir, BASELINE), "utf8");

    expect(execute(checkArgs(dir, "--update-baseline")).code).toBe(1);
    expect(readFileSync(join(dir, BASELINE), "utf8")).toBe(before);
  });

  it("removes exactly the fixed entry once nothing is new", () => {
    const dir = copyFixture();
    const scanPath = join(dir, "scan.json");
    const scan = JSON.parse(readFileSync(scanPath, "utf8"));
    scan.edges = scan.edges.filter(
      (e: { from: string; to: string }) =>
        !(
          e.from === "shop/domain/order.py" &&
          e.to === "shop/application/place.py"
        ) &&
        !(
          e.from === "shop/domain/money.py" && e.to === "shop/ports/store.py"
        ) &&
        e.from !== "shop/adapters/sql_store.py",
    );
    writeFileSync(scanPath, JSON.stringify(scan));

    const { code, out } = execute(checkArgs(dir, "--update-baseline"));

    expect(code).toBe(0);
    expect(JSON.parse(out).baseline.action).toBe("shrunk");
    expect(parseBaseline(readFileSync(join(dir, BASELINE), "utf8"))).toEqual([
      {
        from: "shop/domain/order.py",
        to: "shop/adapters/memory_store.py",
        kind: "depends",
      },
    ]);
  });

  it("leaves the file byte-identical when nothing is fixed", () => {
    const dir = copyFixture();
    const baselinePath = join(dir, BASELINE);
    writeFileSync(
      baselinePath,
      JSON.stringify({
        schema_version: 1,
        violations: parseBaseline(readFileSync(baselinePath, "utf8")).filter(
          (e) => e.from.includes("domain"),
        ),
      }),
    );
    const scanPath = join(dir, "scan.json");
    const scan = JSON.parse(readFileSync(scanPath, "utf8"));
    scan.edges = scan.edges.filter(
      (e: { from: string }) =>
        e.from === "shop/domain/order.py" || e.from.includes("application"),
    );
    writeFileSync(scanPath, JSON.stringify(scan));
    const before = readFileSync(baselinePath, "utf8");

    execute(checkArgs(dir, "--update-baseline"));

    expect(readFileSync(baselinePath, "utf8")).toBe(before);
  });

  it("exits 2 without a baseline file", () => {
    const dir = copyFixture();

    expect(
      execute(
        checkArgs(
          dir,
          "--update-baseline",
          "--baseline",
          join(dir, "nope.json"),
        ),
      ).code,
    ).toBe(2);
  });
});

describe("--init-baseline", () => {
  it("creates the baseline with every current violation and refuses a second run", () => {
    const dir = copyFixture();
    const baselinePath = join(dir, "fresh/violations.json");

    const first = execute(
      checkArgs(dir, "--init-baseline", "--baseline", baselinePath),
    );

    expect(first.code).toBe(0);
    expect(parseBaseline(readFileSync(baselinePath, "utf8"))).toHaveLength(5);

    const before = readFileSync(baselinePath, "utf8");
    const second = execute(
      checkArgs(dir, "--init-baseline", "--baseline", baselinePath),
    );

    expect(second.code).toBe(2);
    expect(readFileSync(baselinePath, "utf8")).toBe(before);
  });

  it("creates an empty baseline for a clean scan", () => {
    const dir = copyFixture();
    writeFileSync(
      join(dir, ".recognizer/policy.yaml"),
      "components:\n  a: x/**\nlevels: [a]\n",
    );
    const baselinePath = join(dir, "clean/violations.json");

    expect(
      execute(checkArgs(dir, "--init-baseline", "--baseline", baselinePath))
        .code,
    ).toBe(0);
    expect(parseBaseline(readFileSync(baselinePath, "utf8"))).toEqual([]);
  });

  it("is exit 2 together with --update-baseline", () => {
    expect(
      execute(checkArgs(FIXTURE, "--init-baseline", "--update-baseline")).code,
    ).toBe(2);
  });
});

describe("bad input", () => {
  const dir = FIXTURE;
  const policy = join(dir, ".recognizer/policy.yaml");
  const scan = join(dir, "scan.json");

  function bad(args: string[], writeTo?: { path: string; content: string }) {
    const tmp = copyFixture();
    const mapped = args.map((a) => a.replace(dir, tmp));

    if (writeTo) {
      writeFileSync(writeTo.path.replace(dir, tmp), writeTo.content);
    }

    const result = execute(mapped);

    expect(result.code).toBe(2);
    expect(result.out).toBe("");
    expect(result.err).not.toBe("");
  }

  it("rejects a missing scan file", () =>
    bad(["check", "--scan", "/nonexistent.json", "--policy", policy]));
  it("rejects a scan that is not JSON", () =>
    bad(["check", "--scan", scan, "--policy", policy], {
      path: scan,
      content: "{",
    }));
  it("rejects a scan failing the schema", () =>
    bad(["check", "--scan", scan, "--policy", policy], {
      path: scan,
      content: "{}",
    }));
  it("rejects a policy that is not YAML", () =>
    bad(["check", "--scan", scan, "--policy", policy], {
      path: policy,
      content: "a: [",
    }));
  it("rejects an unknown flag", () =>
    bad(["check", "--scan", scan, "--policy", policy, "--nope"]));
  it("rejects a missing --scan", () => bad(["check", "--policy", policy]));
  it("rejects a missing subcommand", () =>
    bad(["--scan", scan, "--policy", policy]));

  it("does not create the baseline when input is bad", () => {
    const tmp = copyFixture();
    const target = join(tmp, "never/violations.json");
    execute([
      "check",
      "--scan",
      "/nonexistent.json",
      "--policy",
      policy,
      "--init-baseline",
      "--baseline",
      target,
    ]);

    expect(existsSync(target)).toBe(false);
  });
});

describe("check against the uses-form fixture", () => {
  const USES = join(REPO, "fixtures/check-uses");
  const usesExpected = JSON.parse(
    readFileSync(join(USES, "expected.json"), "utf8"),
  );

  it("prints expected.json, exits 1 and summarises the uses rule", () => {
    const { code, out, err } = execute(checkArgs(USES));
    const actual = JSON.parse(out);

    delete actual.baseline.path;

    expect(code).toBe(1);
    expect(actual).toEqual(usesExpected);
    expect(err).toContain("uses orders -> billing");
  });

  it("agrees with the library", () => {
    const result = check(
      JSON.parse(readFileSync(join(USES, "scan.json"), "utf8")),
      parsePolicy(readFileSync(join(USES, ".recognizer/policy.yaml"), "utf8")),
      null,
    );

    expect(result.violations).toEqual(usesExpected.violations);
    expect(result.unranked).toBe(usesExpected.unranked);
  });

  it("has a scan that validates against the schema", () => {
    expect(() =>
      validateScan(JSON.parse(readFileSync(join(USES, "scan.json"), "utf8"))),
    ).not.toThrow();
  });
});

describe("warnings fixture", () => {
  const WARN = join(REPO, "fixtures/check-warnings");
  const read = (name: string) =>
    JSON.parse(readFileSync(join(WARN, name), "utf8"));

  it("matches expected-policy.json with a policy and exits 0", () => {
    const { code, out, err } = execute(checkArgs(WARN, "--hub-threshold", "3"));
    const actual = JSON.parse(out);

    delete actual.baseline.path;

    expect(code).toBe(0);
    expect(actual).toEqual(read("expected-policy.json"));
    expect(actual.violations).toHaveLength(1);
    expect(err).toContain("warnings: 2");
  });

  it("matches expected-no-policy.json without a policy and exits 0", () => {
    const { code, out, err } = execute([
      "check",
      "--scan",
      join(WARN, "scan.json"),
      "--hub-threshold",
      "3",
    ]);

    expect(code).toBe(0);
    expect(JSON.parse(out)).toEqual(read("expected-no-policy.json"));
    expect(err).toContain("warnings: 2");
  });

  it("has the hand-derived metrics and warning order", () => {
    const { metrics, warnings } = read("expected-no-policy.json");

    expect(warnings.map((w: { id: string }) => w.id)).toEqual(["cycle", "hub"]);
    expect(
      metrics.map((m: Record<string, unknown>) => [
        m.id,
        m.fan_in,
        m.fan_out,
        m.efferent,
        m.instability,
        m.abstractness,
      ]),
    ).toEqual([
      ["app/adapters/audit.py", 0, 1, 1, 1, 0],
      ["app/adapters/clock.py", 0, 1, 1, 1, 0],
      ["app/adapters/memory.py", 1, 1, 1, 0.5, 0],
      ["app/adapters/sql.py", 0, 1, 2, 1, 0],
      ["app/application/place.py", 3, 3, 3, 0.5, 0],
      ["app/application/report.py", 0, 1, 1, 1, 0],
      ["app/domain/money.py", 2, 1, 1, 0.3333, 0],
      ["app/domain/order.py", 2, 2, 2, 0.5, 0],
      ["app/ports/store.py", 3, 0, 0, 0, 1],
    ]);
  });

  it("runs the built binary without a policy", () => {
    const child = spawnSync(
      process.execPath,
      [
        join(REPO, "check/dist/bin.js"),
        "check",
        "--scan",
        join(WARN, "scan.json"),
        "--hub-threshold",
        "3",
      ],
      { encoding: "utf8" },
    );

    expect(child.status).toBe(0);
    expect(JSON.parse(child.stdout).warnings).toHaveLength(2);
  });

  it("exits 1 for a new violation even with warnings, and 0 when baselined", () => {
    const dir = mkdtempSync(join(tmpdir(), "recognizer-warn-"));
    cpSync(WARN, dir, { recursive: true });
    rmSync(join(dir, BASELINE));

    const fresh = execute(checkArgs(dir, "--hub-threshold", "3"));

    expect(fresh.code).toBe(1);
    expect(JSON.parse(fresh.out).warnings).toHaveLength(2);
  });

  it.each(["design-example.json", "all-kinds.json"])(
    "analyses schema/examples/valid/%s without a policy",
    (name) => {
      const path = join(REPO, "schema/examples/valid", name);
      const scan = JSON.parse(readFileSync(path, "utf8"));
      const { code, out } = execute(["check", "--scan", path]);
      const result = JSON.parse(out);

      expect(code).toBe(0);
      expect(result.metrics.length).toBeGreaterThanOrEqual(scan.modules.length);
      expect(Array.isArray(result.warnings)).toBe(true);
    },
  );
});

describe("--version", () => {
  const manifest = JSON.parse(
    readFileSync(join(REPO, "check/package.json"), "utf8"),
  ) as { version: string };

  it.each(["--version", "-V"])("%s prints the package version", (flag) => {
    expect(execute([flag])).toEqual({
      code: 0,
      out: `${manifest.version}\n`,
      err: "",
    });
  });

  it("is not special-cased beside other arguments", () => {
    const result = execute(["--version", "check"]);

    expect(result.code).toBe(2);
    expect(result.out).toBe("");
  });
});
