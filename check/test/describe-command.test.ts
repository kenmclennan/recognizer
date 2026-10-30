import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type Io, run } from "../src/cli.js";
import { COMMANDS } from "../src/commands.js";
import { DESCRIBE_FLAGS } from "../src/describe-command.js";
import { fullHelp } from "../src/help.js";
import { capture, REPO } from "./helpers.js";

const FAKE = join(REPO, "check/test/fixtures/fake-describer.mjs");
const ORDER = "shop/domain/order.py";
const STORE = "shop/ports/store.py";
const PLACE = "shop/application/place.py";
const roots: string[] = [];

function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
}

function repository(): string {
  const root = mkdtempSync(join(tmpdir(), "recognizer-describe-"));

  roots.push(root);
  cpSync(join(REPO, "fixtures/python/sample"), root, { recursive: true });
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "user.name", "t");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "sample");

  const scan = JSON.parse(
    readFileSync(join(REPO, "fixtures/python/expected-scan.json"), "utf8"),
  );

  scan.commit = git(root, "rev-parse", "HEAD").trim();
  scan.modified = false;
  mkdirSync(join(root, ".recognizer/cache"), { recursive: true });
  writeFileSync(
    join(root, ".recognizer/cache/scan.python.json"),
    JSON.stringify(scan),
  );

  return root;
}

function configure(root: string, version = "v1", ...flags: string[]): void {
  const command = ["node", FAKE, "{repository}", ...flags, "{request}"];

  writeFileSync(
    join(root, ".recognizer/config.yaml"),
    `describer:\n  command: ${JSON.stringify(command)}\n  version: ${JSON.stringify(version)}\n`,
  );
}

function ready(version = "v1", ...flags: string[]): string {
  const root = repository();

  configure(root, version, ...flags);

  return root;
}

function exec(root: string, ...args: string[]) {
  const out = capture();
  const code = run([...args, "--repository", root], out.io);

  return { code, out: out.out(), err: out.err() };
}

function calls(root: string): string[] {
  const log = join(root, ".recognizer/cache/describer-calls.log");

  return existsSync(log)
    ? readFileSync(log, "utf8").split("\n").filter(Boolean)
    : [];
}

function clearCalls(root: string): void {
  rmSync(join(root, ".recognizer/cache/describer-calls.log"), { force: true });
}

function responsibilities(root: string) {
  return JSON.parse(
    readFileSync(join(root, ".recognizer/responsibilities.json"), "utf8"),
  );
}

function statuses(root: string) {
  const result = exec(root, "describe", "--check", "--json");

  return {
    code: result.code,
    parsed: JSON.parse(result.out) as {
      ok: boolean;
      counts: Record<string, number>;
      gone: string[];
      modules: {
        module: string;
        status: string;
        line: string | null;
        reasons: string[];
      }[];
    },
  };
}

function commitAll(root: string): void {
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "change");

  const file = join(root, ".recognizer/cache/scan.python.json");
  const scan = JSON.parse(readFileSync(file, "utf8"));

  scan.commit = git(root, "rev-parse", "HEAD").trim();
  scan.modified = false;
  scan.files = scan.files
    .filter((entry: { path: string }) => existsSync(join(root, entry.path)))
    .map((entry: { path: string }) => ({
      ...entry,
      hash: createHash("sha256")
        .update(readFileSync(join(root, entry.path)))
        .digest("hex"),
    }));

  writeFileSync(file, JSON.stringify(scan));
}

function edit(root: string, id: string): void {
  writeFileSync(
    join(root, id),
    `${readFileSync(join(root, id), "utf8")}\n# edited\n`,
  );
  commitAll(root);
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("describe status", () => {
  it("reports every module missing with no file", () => {
    const root = ready();
    const { code, parsed } = statuses(root);

    expect(code).toBe(1);
    expect(parsed.ok).toBe(false);
    expect(parsed.counts).toEqual({
      current: 0,
      outOfDate: 0,
      missing: 14,
      unreadable: 0,
    });
    expect(parsed.modules.every((m) => m.line === null)).toBe(true);
  });

  it("makes only an edited module out of date and redescribes only it", () => {
    const root = ready();

    expect(exec(root, "describe").code).toBe(0);
    expect(statuses(root).parsed.counts.current).toBe(14);

    edit(root, ORDER);

    const { parsed } = statuses(root);
    const stale = parsed.modules.filter((m) => m.status === "out-of-date");

    expect(stale.map((m) => m.module)).toEqual([ORDER]);
    expect(stale[0]?.reasons).toEqual(["source"]);
    expect(stale[0]?.line).toBe(`describes ${ORDER}`);
    expect(parsed.counts.current).toBe(13);

    clearCalls(root);
    exec(root, "describe");

    expect(calls(root)).toEqual([ORDER]);
  });

  it("makes every line out of date when the version changes", () => {
    const root = ready();

    exec(root, "describe");
    configure(root, "v2");

    const { parsed } = statuses(root);

    expect(parsed.counts.outOfDate).toBe(14);
    expect(parsed.modules.every((m) => m.reasons.join() === "version")).toBe(
      true,
    );

    clearCalls(root);
    exec(root, "describe");

    expect(calls(root)).toHaveLength(14);
  });

  it("makes every line out of date when the command changes", () => {
    const root = ready();

    exec(root, "describe");
    configure(root, "v1", "--fail", "nothing");

    const { parsed } = statuses(root);

    expect(parsed.counts.outOfDate).toBe(14);
    expect(parsed.modules.every((m) => m.reasons.join() === "describer")).toBe(
      true,
    );
  });

  it("lists source and version reasons in order", () => {
    const root = ready();

    exec(root, "describe");
    edit(root, ORDER);
    configure(root, "v2");

    const order = statuses(root).parsed.modules.find((m) => m.module === ORDER);

    expect(order?.reasons).toEqual(["source", "version"]);
  });
});

describe("describe selection", () => {
  it("calls nothing and writes nothing when every line is current", () => {
    const root = ready();

    exec(root, "describe");

    const file = join(root, ".recognizer/responsibilities.json");
    const before = readFileSync(file, "utf8");
    const mtime = statSync(file).mtimeMs;

    clearCalls(root);

    const result = exec(root, "describe");

    expect(result.code).toBe(0);
    expect(result.out).toContain("described 0, failed 0, already current 14");
    expect(calls(root)).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(statSync(file).mtimeMs).toBe(mtime);
  });

  it("redoes a named current module and only the named ones", () => {
    const root = ready();

    exec(root, "describe");
    clearCalls(root);
    exec(root, "describe", ORDER);

    expect(calls(root)).toEqual([ORDER]);

    clearCalls(root);
    exec(root, "describe", STORE, ORDER);

    expect(calls(root)).toEqual([ORDER, STORE]);
  });

  it("redoes everything with --all", () => {
    const root = ready();

    exec(root, "describe");
    clearCalls(root);
    exec(root, "describe", "--all");

    expect(calls(root)).toHaveLength(14);
  });

  it("exits 2 for an unknown module and runs nothing", () => {
    const root = ready();
    const result = exec(root, "describe", "nope.py", ORDER);

    expect(result.code).toBe(2);
    expect(result.err).toContain("no such module: nope.py");
    expect(calls(root)).toEqual([]);
    expect(existsSync(join(root, ".recognizer/responsibilities.json"))).toBe(
      false,
    );
  });

  it("exits 2 for --all with a name and for --check with --all", () => {
    const root = ready();

    expect(exec(root, "describe", "--all", ORDER).code).toBe(2);
    expect(exec(root, "describe", "--check", "--all").code).toBe(2);
    expect(calls(root)).toEqual([]);
  });

  it("prints JSON for a run", () => {
    const root = ready();
    const result = exec(root, "describe", ORDER, "--json");

    expect(JSON.parse(result.out)).toEqual({
      described: [ORDER],
      failed: [],
      current: 0,
      pruned: [],
    });
  });
});

describe("describe failures", () => {
  it.each([
    ["exits non-zero", "--fail"],
    ["prints nothing", "--empty"],
    ["prints two lines", "--two-lines"],
  ])("leaves a line unchanged when the describer %s", (_, flag) => {
    const root = ready();

    exec(root, "describe");

    const before = readFileSync(
      join(root, ".recognizer/responsibilities.json"),
      "utf8",
    );

    configure(root, "v1", flag, ORDER);

    const result = exec(root, "describe", ORDER, "--json");
    const report = JSON.parse(result.out);

    expect(result.code).toBe(1);
    expect(result.err).toContain(`failed ${ORDER}`);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0].module).toBe(ORDER);
    expect(report.described).toEqual([]);

    const after = responsibilities(root);

    expect(JSON.stringify(after)).toBe(JSON.stringify(JSON.parse(before)));
  });

  it("reports the describer's stderr as the reason", () => {
    const root = ready("v1", "--fail", ORDER);
    const report = JSON.parse(exec(root, "describe", ORDER, "--json").out);

    expect(report.failed[0].reason).toBe(`cannot describe ${ORDER}`);
  });

  it("leaves an absent entry absent and still writes the others", () => {
    const root = ready("v1", "--fail", ORDER);
    const result = exec(root, "describe", "--all", "--json");
    const report = JSON.parse(result.out);
    const file = responsibilities(root);

    expect(result.code).toBe(1);
    expect(report.described).toHaveLength(13);
    expect(report.failed).toHaveLength(1);
    expect(Object.keys(file.modules)).toHaveLength(13);
    expect(file.modules[ORDER]).toBeUndefined();
  });

  it("keeps the old entry in a mixed --all run", () => {
    const root = ready();

    exec(root, "describe");

    const old = responsibilities(root).modules[ORDER];

    configure(root, "v1", "--fail", ORDER);
    configure(root, "v1", "--fail", ORDER);

    const result = exec(root, "describe", "--all", "--json");
    const file = responsibilities(root);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.out).described).toHaveLength(13);
    expect(Object.keys(file.modules)).toHaveLength(14);
    expect(file.modules[ORDER]).toEqual(old);
  });

  it("reports a program that does not exist as failed", () => {
    const root = repository();

    writeFileSync(
      join(root, ".recognizer/config.yaml"),
      'describer:\n  command: ["/no/such/describer", "{request}"]\n  version: "v1"\n',
    );

    const result = exec(root, "describe", ORDER, "--json");

    expect(result.code).toBe(1);
    expect(JSON.parse(result.out).failed[0].module).toBe(ORDER);
    expect(existsSync(join(root, ".recognizer/responsibilities.json"))).toBe(
      false,
    );
  });

  it("reports an unreadable source as failed", () => {
    const root = ready();

    rmSync(join(root, ORDER));
    commitAll(root);

    const result = exec(root, "describe", "--json");
    const report = JSON.parse(result.out);

    expect(result.code).toBe(1);
    expect(report.failed.map((f: { module: string }) => f.module)).toEqual([
      ORDER,
    ]);
    expect(report.described).toHaveLength(13);
    expect(calls(root)).not.toContain(ORDER);
  });
});

describe("describe write path", () => {
  it("writes each success before the next module and leaves no temp file", () => {
    const root = ready("v1", "--fail", STORE);

    exec(root, "describe", ORDER, STORE);

    expect(Object.keys(responsibilities(root).modules)).toEqual([ORDER]);
    expect(readdirSync(join(root, ".recognizer"))).not.toContain(
      "responsibilities.json.tmp",
    );
  });

  it("writes sorted, indented, key-ordered JSON with a trailing newline", () => {
    const root = ready();

    exec(root, "describe", STORE, ORDER);

    const text = readFileSync(
      join(root, ".recognizer/responsibilities.json"),
      "utf8",
    );
    const file = JSON.parse(text);

    expect(Object.keys(file)).toEqual(["schema_version", "modules"]);
    expect(Object.keys(file.modules)).toEqual([ORDER, STORE]);
    expect(Object.keys(file.modules[ORDER])).toEqual([
      "line",
      "source_hash",
      "describer",
      "version",
    ]);
    expect(text).toBe(`${JSON.stringify(file, null, 2)}\n`);
    expect(file.modules[ORDER].describer).toEqual([
      "node",
      FAKE,
      "{repository}",
      "{request}",
    ]);
  });

  it("removes the temp directory it made", () => {
    const root = ready("v1", "--fail", STORE);
    const out = capture();
    const made: string[] = [];
    const removed: string[] = [];
    const io: Io = {
      ...out.io,
      makeTempDir: () => {
        const dir = out.io.makeTempDir();

        made.push(dir);

        return dir;
      },
      removeDir: (path) => {
        removed.push(path);
        out.io.removeDir(path);
      },
    };

    run(["describe", ORDER, STORE, "--repository", root], io);

    expect(made).toHaveLength(1);
    expect(removed).toEqual(made);
    expect(existsSync(made[0] as string)).toBe(false);
  });
});

describe("describe request", () => {
  it("gives the describer the module's source, members and neighbours", () => {
    const root = ready();
    const copy = join(root, ".recognizer/cache/request.json");

    configure(root, "v1", "--copy", copy);
    exec(root, "describe", PLACE);

    const request = JSON.parse(readFileSync(copy, "utf8"));
    const scan = JSON.parse(
      readFileSync(join(REPO, "fixtures/python/expected-scan.json"), "utf8"),
    );
    const module = scan.modules.find((m: { id: string }) => m.id === PLACE);

    expect(Object.keys(request).sort()).toEqual(
      ["kind", "members", "module", "source", "used_by", "uses"].sort(),
    );
    expect(request.module).toBe(PLACE);
    expect(request.kind).toBe(module.kind);
    expect(request.source).toBe(readFileSync(join(root, PLACE), "utf8"));
    expect(request.members).toEqual(module.members);
    expect(request.uses.map((row: { id: string }) => row.id)).toEqual([
      ORDER,
      STORE,
    ]);
    expect(request.used_by).toEqual([]);
  });
});

describe("describe prune", () => {
  it("removes an entry for a module no longer in the scan and reports it", () => {
    const root = ready();

    exec(root, "describe");

    const file = responsibilities(root);

    file.modules["gone.py"] = file.modules[ORDER];
    writeFileSync(
      join(root, ".recognizer/responsibilities.json"),
      JSON.stringify(file),
    );

    const check = statuses(root);

    expect(check.parsed.gone).toEqual(["gone.py"]);
    expect(check.parsed.ok).toBe(true);
    expect(check.code).toBe(0);

    const result = exec(root, "describe", "--json");

    expect(JSON.parse(result.out).pruned).toEqual(["gone.py"]);
    expect(responsibilities(root).modules["gone.py"]).toBeUndefined();
  });
});

describe("describe config", () => {
  it("exits 2 with a config message when there is no describer", () => {
    const root = repository();

    expect(exec(root, "describe").err).toContain("config");

    writeFileSync(join(root, ".recognizer/config.yaml"), "{}\n");

    const result = exec(root, "describe");

    expect(result.code).toBe(2);
    expect(result.err).toContain("config");
  });

  it.each([
    ["an unknown key", "describer:\n  command: [x]\n  version: v\nother: 1\n"],
    ["an empty command", "describer:\n  command: []\n  version: v\n"],
    ["invalid YAML", "describer: [unclosed\n"],
  ])("exits 2 with a config message for %s", (_, text) => {
    const root = repository();

    writeFileSync(join(root, ".recognizer/config.yaml"), text);

    const result = exec(root, "describe");

    expect(result.code).toBe(2);
    expect(result.err).toContain("config");
    expect(calls(root)).toEqual([]);
  });

  it("exits 2 for an invalid responsibilities file", () => {
    const root = ready();

    writeFileSync(join(root, ".recognizer/responsibilities.json"), "{}");

    const result = exec(root, "describe");

    expect(result.code).toBe(2);
    expect(result.err).toContain("responsibilities");
  });
});

describe("describe --check", () => {
  it("prints text rows for current, out-of-date and missing modules", () => {
    const root = ready();

    exec(root, "describe", ORDER, STORE);
    edit(root, ORDER);

    const result = exec(root, "describe", "--check");
    const rows = result.out.split("\n");

    expect(result.code).toBe(1);
    expect(rows).toContain(
      `${ORDER}  out-of-date  describes ${ORDER} (source changed)`,
    );
    expect(rows).toContain(`${STORE}  current  describes ${STORE}`);
    expect(rows).toContain(`${PLACE}  missing`);
    expect(rows).toContain("1 current, 1 out of date, 12 missing");
  });

  it("exits 0 only when every module is current", () => {
    const root = ready();

    exec(root, "describe");

    expect(exec(root, "describe", "--check").code).toBe(0);
  });

  it("restricts output to the named modules", () => {
    const root = ready();
    const result = exec(root, "describe", "--check", "--json", ORDER);

    expect(
      JSON.parse(result.out).modules.map((m: { module: string }) => m.module),
    ).toEqual([ORDER]);
  });

  it("runs no describer and writes nothing", () => {
    const root = ready();

    exec(root, "describe", "--check");

    expect(
      existsSync(join(root, ".recognizer/cache/describer-calls.log")),
    ).toBe(false);
    expect(existsSync(join(root, ".recognizer/responsibilities.json"))).toBe(
      false,
    );
  });
});

describe("no describing as a side effect", () => {
  it("never runs the describer from describe --check", () => {
    const root = ready();
    const out = capture();
    const programs: string[] = [];
    const io: Io = {
      ...out.io,
      run: (command, args) => {
        programs.push(command);

        return out.io.run(command, args);
      },
    };

    run(["describe", "--check", "--repository", root], io);

    expect(programs).not.toContain("node");
    expect(exec(root, "scan", root).code === 0 || existsSync(root)).toBe(true);
    expect(calls(root)).toEqual([]);
    expect(existsSync(join(root, ".recognizer/responsibilities.json"))).toBe(
      false,
    );
  });
});

describe("describe help", () => {
  const command = COMMANDS.find((entry) => entry.name === "describe");

  it("names every flag the parser takes", () => {
    const help = fullHelp(command as (typeof COMMANDS)[number]);

    for (const flag of DESCRIBE_FLAGS) {
      expect(help).toContain(flag);
    }

    expect(command?.options.map((o) => o.flag.split(" ")[0])).toEqual(
      expect.arrayContaining(DESCRIBE_FLAGS),
    );
  });

  it("is named in the short help", () => {
    const out = capture();

    run(["--help"], out.io);

    expect(out.out()).toContain("describe");
  });
});
