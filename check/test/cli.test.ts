import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { check, parseBaseline, parsePolicy } from "../src/index.js";
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
    writeFileSync(policyPath, 'levels: [a]\nignore: ["**"]\n');

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
    writeFileSync(join(dir, ".recognizer/policy.yaml"), "levels: [a]\n");
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
  it("rejects a missing --policy", () => bad(["check", "--scan", scan]));
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
