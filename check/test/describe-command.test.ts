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
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

function repository(language = "python"): string {
  const root = mkdtempSync(join(tmpdir(), "recognizer-describe-"));

  roots.push(root);
  cpSync(join(REPO, `fixtures/${language}/sample`), root, { recursive: true });
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "user.name", "t");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "sample");

  const scan = JSON.parse(
    readFileSync(join(REPO, `fixtures/${language}/expected-scan.json`), "utf8"),
  );

  scan.commit = git(root, "rev-parse", "HEAD").trim();
  scan.modified = false;
  mkdirSync(join(root, ".recognizer/cache"), { recursive: true });
  writeFileSync(
    join(root, `.recognizer/cache/scan.${language}.json`),
    JSON.stringify(scan),
  );

  return root;
}

function useDescribing(model: string, batchSize: number): void {
  writeFileSync(
    join(process.env.RECOGNIZER_APP_CONFIG_DIR as string, "config.json"),
    JSON.stringify({ describing: { model, batch_size: batchSize } }),
  );
}

beforeEach(() => {
  useDescribing("sonnet", 4);
});

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

async function exec(root: string, ...args: string[]) {
  const out = capture();
  const code = await run([...args, "--repository", root], out.io);

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

async function statuses(root: string) {
  const result = await exec(root, "describe", "--check", "--json");

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

  const file = join(root, `.recognizer/cache/scan.python.json`);
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
  it("reports every module missing with no file", async () => {
    const root = ready();
    const { code, parsed } = await statuses(root);

    expect(code).toBe(1);
    expect(parsed.ok).toBe(false);
    expect(parsed.counts).toEqual({
      current: 0,
      outOfDate: 0,
      missing: 15,
      unreadable: 0,
    });
    expect(parsed.modules.every((m) => m.line === null)).toBe(true);
  });

  it("makes only an edited module out of date and redescribes only it", async () => {
    const root = ready();

    expect((await exec(root, "describe")).code).toBe(0);
    expect((await statuses(root)).parsed.counts.current).toBe(15);

    edit(root, ORDER);

    const { parsed } = await statuses(root);
    const stale = parsed.modules.filter((m) => m.status === "out-of-date");

    expect(stale.map((m) => m.module)).toEqual([ORDER]);
    expect(stale[0]?.reasons).toEqual(["source"]);
    expect(stale[0]?.line).toBe(`describes ${ORDER}`);
    expect(parsed.counts.current).toBe(14);

    clearCalls(root);
    await exec(root, "describe");

    expect(calls(root)).toEqual([ORDER]);
  });

  it("makes every line out of date when the version changes", async () => {
    const root = ready();

    await exec(root, "describe");
    configure(root, "v2");

    const { parsed } = await statuses(root);

    expect(parsed.counts.outOfDate).toBe(15);
    expect(parsed.modules.every((m) => m.reasons.join() === "version")).toBe(
      true,
    );

    clearCalls(root);
    await exec(root, "describe");

    expect(calls(root)).toHaveLength(15);
  });

  it("makes every line out of date when the command changes", async () => {
    const root = ready();

    await exec(root, "describe");
    configure(root, "v1", "--fail", "nothing");

    const { parsed } = await statuses(root);

    expect(parsed.counts.outOfDate).toBe(15);
    expect(parsed.modules.every((m) => m.reasons.join() === "describer")).toBe(
      true,
    );
  });

  it("lists source and version reasons in order", async () => {
    const root = ready();

    await exec(root, "describe");
    edit(root, ORDER);
    configure(root, "v2");

    const order = (await statuses(root)).parsed.modules.find(
      (m) => m.module === ORDER,
    );

    expect(order?.reasons).toEqual(["source", "version"]);
  });
});

describe("describe selection", () => {
  it("calls nothing and writes nothing when every line is current", async () => {
    const root = ready();

    await exec(root, "describe");

    const file = join(root, ".recognizer/responsibilities.json");
    const before = readFileSync(file, "utf8");
    const mtime = statSync(file).mtimeMs;

    clearCalls(root);

    const result = await exec(root, "describe");

    expect(result.code).toBe(0);
    expect(result.out).toContain("described 0, failed 0, already current 15");
    expect(calls(root)).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(statSync(file).mtimeMs).toBe(mtime);
  });

  it("redoes a named current module and only the named ones", async () => {
    const root = ready();

    await exec(root, "describe");
    clearCalls(root);
    await exec(root, "describe", ORDER);

    expect(calls(root)).toEqual([ORDER]);

    clearCalls(root);
    await exec(root, "describe", STORE, ORDER);

    expect([...calls(root)].sort()).toEqual([ORDER, STORE].sort());
  });

  it("redoes everything with --all", async () => {
    const root = ready();

    await exec(root, "describe");
    clearCalls(root);
    await exec(root, "describe", "--all");

    expect(calls(root)).toHaveLength(15);
  });

  it("exits 2 for an unknown module and runs nothing", async () => {
    const root = ready();
    const result = await exec(root, "describe", "nope.py", ORDER);

    expect(result.code).toBe(2);
    expect(result.err).toContain("no such module: nope.py");
    expect(calls(root)).toEqual([]);
    expect(existsSync(join(root, ".recognizer/responsibilities.json"))).toBe(
      false,
    );
  });

  it("exits 2 for --all with a name and for --check with --all", async () => {
    const root = ready();

    expect((await exec(root, "describe", "--all", ORDER)).code).toBe(2);
    expect((await exec(root, "describe", "--check", "--all")).code).toBe(2);
    expect(calls(root)).toEqual([]);
  });

  it("prints JSON for a run", async () => {
    const root = ready();
    const result = await exec(root, "describe", ORDER, "--json");

    expect(JSON.parse(result.out)).toEqual({
      described: [ORDER],
      failed: [],
      current: 0,
      pruned: [],
      stopped: null,
    });
  });
});

describe("describe stops on a usage limit", () => {
  it("exits 1 with stopped in the JSON and the lines already written kept", async () => {
    const root = ready("v1", "--limit", ORDER);

    useDescribing("sonnet", 1);

    const result = await exec(root, "describe", PLACE, ORDER, STORE, "--json");
    const body = JSON.parse(result.out);

    expect(result.code).toBe(1);
    expect(body.described).toEqual([PLACE]);
    expect(body.failed.map((one: { module: string }) => one.module)).toEqual([
      ORDER,
    ]);
    expect(body.stopped).toMatchObject({
      cause: "limit",
      module: ORDER,
      described: 1,
      not_described: [STORE],
    });
    expect(Object.keys(responsibilities(root).modules)).toEqual([PLACE]);
    expect(calls(root)).toEqual([PLACE, ORDER]);
  });

  it("says why it stopped in the summary", async () => {
    const root = ready("v1", "--limit", ORDER);

    useDescribing("sonnet", 1);

    const result = await exec(root, "describe", PLACE, ORDER, STORE);

    expect(result.out).toContain(
      "stopped: claude usage limit reached (claude usage limit: Claude usage limit reached); described 1, failed 1, not described 1, already current 0\n",
    );
  });
});

describe("describe failures", () => {
  it.each([
    ["exits non-zero", "--fail"],
    ["prints nothing", "--empty"],
    ["prints two lines", "--two-lines"],
  ])("leaves a line unchanged when the describer %s", async (_, flag) => {
    const root = ready();

    await exec(root, "describe");

    const before = readFileSync(
      join(root, ".recognizer/responsibilities.json"),
      "utf8",
    );

    configure(root, "v1", flag, ORDER);

    const result = await exec(root, "describe", ORDER, "--json");
    const report = JSON.parse(result.out);

    expect(result.code).toBe(1);
    expect(result.err).toContain(`failed ${ORDER}`);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0].module).toBe(ORDER);
    expect(report.described).toEqual([]);

    const after = responsibilities(root);

    expect(JSON.stringify(after)).toBe(JSON.stringify(JSON.parse(before)));
  });

  it("reports the describer's stderr as the reason", async () => {
    const root = ready("v1", "--fail", ORDER);
    const report = JSON.parse(
      (await exec(root, "describe", ORDER, "--json")).out,
    );

    expect(report.failed[0].reason).toBe(`cannot describe ${ORDER}`);
  });

  it("leaves an absent entry absent and still writes the others", async () => {
    const root = ready("v1", "--fail", ORDER);
    const result = await exec(root, "describe", "--all", "--json");
    const report = JSON.parse(result.out);
    const file = responsibilities(root);

    expect(result.code).toBe(1);
    expect(report.described).toHaveLength(14);
    expect(report.failed).toHaveLength(1);
    expect(Object.keys(file.modules)).toHaveLength(14);
    expect(file.modules[ORDER]).toBeUndefined();
  });

  it("keeps the old entry in a mixed --all run", async () => {
    const root = ready();

    await exec(root, "describe");

    const old = responsibilities(root).modules[ORDER];

    configure(root, "v1", "--fail", ORDER);
    configure(root, "v1", "--fail", ORDER);

    const result = await exec(root, "describe", "--all", "--json");
    const file = responsibilities(root);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.out).described).toHaveLength(14);
    expect(Object.keys(file.modules)).toHaveLength(15);
    expect(file.modules[ORDER]).toEqual(old);
  });

  it("reports a program that does not exist as failed", async () => {
    const root = repository();

    writeFileSync(
      join(root, ".recognizer/config.yaml"),
      'describer:\n  command: ["/no/such/describer", "{request}"]\n  version: "v1"\n',
    );

    const result = await exec(root, "describe", ORDER, "--json");

    expect(result.code).toBe(1);
    expect(JSON.parse(result.out).failed[0].module).toBe(ORDER);
    expect(existsSync(join(root, ".recognizer/responsibilities.json"))).toBe(
      false,
    );
  });

  it("reports an unreadable source as failed", async () => {
    const root = ready();

    rmSync(join(root, ORDER));
    commitAll(root);

    const result = await exec(root, "describe", "--json");
    const report = JSON.parse(result.out);

    expect(result.code).toBe(1);
    expect(report.failed.map((f: { module: string }) => f.module)).toEqual([
      ORDER,
    ]);
    expect(report.described).toHaveLength(14);
    expect(calls(root)).not.toContain(ORDER);
  });
});

describe("describe a Kotlin file module", () => {
  it("reports only the module of a deleted file unreadable", async () => {
    const root = repository("kotlin");
    const gone = "app/src/main/kotlin/shop/domain/Order.kt";

    configure(root);
    await exec(root, "describe");
    rmSync(join(root, gone));
    git(root, "add", "-A", "--", ".", ":!.recognizer");
    git(root, "commit", "-q", "-m", "delete");

    const cache = join(root, ".recognizer/cache/scan.kotlin.json");
    const scan = JSON.parse(readFileSync(cache, "utf8"));

    scan.commit = git(root, "rev-parse", "HEAD").trim();
    writeFileSync(cache, JSON.stringify(scan));

    const recorded = scan.files.find(
      (entry: { path: string }) => entry.path === gone,
    );
    const out = capture();
    const io: Io = {
      ...out.io,
      hashFile: (path) =>
        path.endsWith(recorded.path) ? recorded.hash : out.io.hashFile(path),
    };
    const code = await run(
      ["describe", "--check", "--json", "--repository", root],
      io,
    );
    const parsed = JSON.parse(out.out());

    expect(code).toBe(1);
    expect(parsed.counts.unreadable).toBe(1);
    expect(parsed.counts.current).toBe(9);
    expect(
      parsed.modules
        .filter((m: { status: string }) => m.status === "unreadable")
        .map((m: { module: string }) => m.module),
    ).toEqual([gone]);
  });
});

describe("describe write path", () => {
  it("writes each success before the next module and leaves no temp file", async () => {
    const root = ready("v1", "--fail", STORE);

    await exec(root, "describe", ORDER, STORE);

    expect(Object.keys(responsibilities(root).modules)).toEqual([ORDER]);
    expect(readdirSync(join(root, ".recognizer"))).not.toContain(
      "responsibilities.json.tmp",
    );
  });

  it("writes sorted, indented, key-ordered JSON with a trailing newline", async () => {
    const root = ready();

    await exec(root, "describe", STORE, ORDER);

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

  it("removes the temp directory it made", async () => {
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

    await run(["describe", ORDER, STORE, "--repository", root], io);

    expect(made).toHaveLength(1);
    expect(removed).toEqual(made);
    expect(existsSync(made[0] as string)).toBe(false);
  });
});

describe("describe request", () => {
  it("gives the describer the module's source, members and neighbours", async () => {
    const root = ready();
    const copy = join(root, ".recognizer/cache/request.json");

    configure(root, "v1", "--copy", copy);
    await exec(root, "describe", PLACE);

    const request = JSON.parse(readFileSync(copy, "utf8"));
    const scan = JSON.parse(
      readFileSync(join(REPO, `fixtures/python/expected-scan.json`), "utf8"),
    );
    const module = scan.modules.find((m: { id: string }) => m.id === PLACE);

    expect(Object.keys(request).sort()).toEqual(
      [
        "files",
        "kind",
        "members",
        "module",
        "source",
        "used_by",
        "uses",
      ].sort(),
    );
    expect(request.files).toEqual([PLACE]);
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
  it("removes an entry for a module no longer in the scan and reports it", async () => {
    const root = ready();

    await exec(root, "describe");

    const file = responsibilities(root);

    file.modules["gone.py"] = file.modules[ORDER];
    writeFileSync(
      join(root, ".recognizer/responsibilities.json"),
      JSON.stringify(file),
    );

    const check = await statuses(root);

    expect(check.parsed.gone).toEqual(["gone.py"]);
    expect(check.parsed.ok).toBe(true);
    expect(check.code).toBe(0);

    const result = await exec(root, "describe", "--json");

    expect(JSON.parse(result.out).pruned).toEqual(["gone.py"]);
    expect(responsibilities(root).modules["gone.py"]).toBeUndefined();
  });
});

const SHIPPED_VERSION = "prompt-0123456789ab";
const originalPath = process.env.PATH;
const binDirs: string[] = [];

function withoutShippedDescriber(): void {
  const dir = mkdtempSync(join(tmpdir(), "recognizer-bin-"));

  binDirs.push(dir);
  symlinkSync(
    execFileSync("which", ["git"], { encoding: "utf8" }).trim(),
    join(dir, "git"),
  );
  process.env.PATH = dir;
}

function installShippedDescriber(): void {
  const dir = mkdtempSync(join(tmpdir(), "recognizer-bin-"));

  binDirs.push(dir);

  const script = join(dir, "recognizer-describe-claude");

  writeFileSync(
    script,
    [
      "#!/usr/bin/env node",
      `if (process.argv[2] === "--prompt-version") { process.stdout.write("${SHIPPED_VERSION}\\n"); process.exit(0); }`,
      'import { readFileSync } from "node:fs";',
      'const { module } = JSON.parse(readFileSync(process.argv[process.argv.length - 1], "utf8"));',
      'process.stdout.write("shipped " + module + "\\n");',
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  process.env.PATH = `${dir}:${process.env.PATH}`;
}

beforeEach(() => {
  process.env.PATH = originalPath;
});

afterEach(() => {
  process.env.PATH = originalPath;

  for (const dir of binDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("describer in effect", () => {
  it("reports the configured describer with source config", async () => {
    const root = ready("v7");
    const result = await exec(root, "describe", "--describer", "--json");

    expect(result.code).toBe(0);
    expect(JSON.parse(result.out)).toEqual({
      command: ["node", FAKE, "{repository}", "{request}"],
      version: "v7",
      source: "config",
    });
  });

  it("reports the shipped describer when none is configured", async () => {
    installShippedDescriber();

    const result = await exec(
      repository(),
      "describe",
      "--describer",
      "--json",
    );

    expect(result.code).toBe(0);
    expect(JSON.parse(result.out)).toEqual({
      command: [
        "recognizer-describe-claude",
        "--model",
        "{model}",
        "{request}",
      ],
      version: SHIPPED_VERSION,
      source: "shipped",
    });
  });

  it("prints one plain line without --json", async () => {
    installShippedDescriber();

    const result = await exec(repository(), "describe", "--describer");

    expect(result.out).toBe(
      `recognizer-describe-claude --model {model} {request}  ${SHIPPED_VERSION}  shipped\n`,
    );
  });

  it("exits 2 naming the missing describer when neither exists", async () => {
    const root = repository();

    withoutShippedDescriber();

    const result = await exec(root, "describe", "--describer");

    expect(result.code).toBe(2);
    expect(result.err).toContain("no describer is registered");
    expect(result.err).toContain("recognizer-describe-claude is not installed");
  });

  it("prefers a configured describer over an installed fallback", async () => {
    installShippedDescriber();

    const root = ready("v3");

    expect(
      JSON.parse((await exec(root, "describe", "--describer", "--json")).out)
        .source,
    ).toBe("config");
    expect((await exec(root, "describe", "--all")).code).toBe(0);
    expect(responsibilities(root).modules[ORDER].describer[0]).toBe("node");
  });

  it("describes with the fallback and records its command and version", async () => {
    installShippedDescriber();

    const root = repository();

    expect((await exec(root, "describe", "--all")).code).toBe(0);

    const entry = responsibilities(root).modules[ORDER];

    expect(entry.describer).toEqual([
      "recognizer-describe-claude",
      "--model",
      "{model}",
      "{request}",
    ]);
    expect(entry.version).toBe(SHIPPED_VERSION);
    expect(entry.line).toBe(`shipped ${ORDER}`);
    expect((await statuses(root)).parsed.ok).toBe(true);
  });
});

describe("describe config", () => {
  it("exits 2 with a config message when there is no describer", async () => {
    const root = repository();

    withoutShippedDescriber();

    expect((await exec(root, "describe")).err).toContain("config");

    writeFileSync(join(root, ".recognizer/config.yaml"), "{}\n");

    const result = await exec(root, "describe");

    expect(result.code).toBe(2);
    expect(result.err).toContain("config");
  });

  it.each([
    ["an unknown key", "describer:\n  command: [x]\n  version: v\nother: 1\n"],
    ["an empty command", "describer:\n  command: []\n  version: v\n"],
    ["invalid YAML", "describer: [unclosed\n"],
  ])("exits 2 with a config message for %s", async (_, text) => {
    const root = repository();

    writeFileSync(join(root, ".recognizer/config.yaml"), text);

    const result = await exec(root, "describe");

    expect(result.code).toBe(2);
    expect(result.err).toContain("config");
    expect(calls(root)).toEqual([]);
  });

  it("exits 2 for an invalid responsibilities file", async () => {
    const root = ready();

    writeFileSync(join(root, ".recognizer/responsibilities.json"), "{}");

    const result = await exec(root, "describe");

    expect(result.code).toBe(2);
    expect(result.err).toContain("responsibilities");
  });
});

describe("describe --check", () => {
  it("prints text rows for current, out-of-date and missing modules", async () => {
    const root = ready();

    await exec(root, "describe", ORDER, STORE);
    edit(root, ORDER);

    const result = await exec(root, "describe", "--check");
    const rows = result.out.split("\n");

    expect(result.code).toBe(1);
    expect(rows).toContain(
      `${ORDER}  out-of-date  describes ${ORDER} (source changed)`,
    );
    expect(rows).toContain(`${STORE}  current  describes ${STORE}`);
    expect(rows).toContain(`${PLACE}  missing`);
    expect(rows).toContain("1 current, 1 out of date, 13 missing");
  });

  it("exits 0 only when every module is current", async () => {
    const root = ready();

    await exec(root, "describe");

    expect((await exec(root, "describe", "--check")).code).toBe(0);
  });

  it("restricts output to the named modules", async () => {
    const root = ready();
    const result = await exec(root, "describe", "--check", "--json", ORDER);

    expect(
      JSON.parse(result.out).modules.map((m: { module: string }) => m.module),
    ).toEqual([ORDER]);
  });

  it("runs no describer and writes nothing", async () => {
    const root = ready();

    await exec(root, "describe", "--check");

    expect(
      existsSync(join(root, ".recognizer/cache/describer-calls.log")),
    ).toBe(false);
    expect(existsSync(join(root, ".recognizer/responsibilities.json"))).toBe(
      false,
    );
  });
});

describe("no describing as a side effect", () => {
  it("never runs the describer from describe --check", async () => {
    const root = ready();
    const out = capture();
    const programs: string[] = [];
    const io: Io = {
      ...out.io,
      run: (command, args) => {
        programs.push(command);

        return out.io.run(command, args);
      },
      runAsync: (command, args) => {
        programs.push(command);

        return out.io.runAsync(command, args);
      },
    };

    await run(["describe", "--check", "--repository", root], io);

    expect(programs).not.toContain("node");
    expect(
      (await exec(root, "scan", root)).code === 0 || existsSync(root),
    ).toBe(true);
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

  it("is named in the short help", async () => {
    const out = capture();

    await run(["--help"], out.io);

    expect(out.out()).toContain("describe");
  });
});

describe("describe leaves a run record", () => {
  function recorded(root: string) {
    const directory = join(root, ".recognizer/cache/log");

    return existsSync(directory)
      ? readdirSync(directory).map((name) =>
          JSON.parse(readFileSync(join(directory, name), "utf8")),
        )
      : [];
  }

  it("records a failing describer's stderr, command and who asked", async () => {
    const root = ready("v1", "--fail", ORDER);
    const result = await exec(
      root,
      "describe",
      ORDER,
      "--by",
      "Claude",
      "--json",
    );
    const [saved] = recorded(root);

    expect(result.code).toBe(1);
    expect(recorded(root)).toHaveLength(1);
    expect(saved).toMatchObject({
      kind: "describe",
      by: "Claude",
      outcome: "failed",
      exit: 1,
    });
    expect(saved.entries).toHaveLength(1);
    expect(saved.entries[0]).toMatchObject({
      name: ORDER,
      status: 1,
      outcome: "failed",
      reason: `cannot describe ${ORDER}`,
      stderr: `cannot describe ${ORDER}`,
    });
    expect(saved.entries[0].command.slice(0, 2)).toEqual(["node", FAKE]);
  });

  it("leaves a running record with the finished entries when killed between children", async () => {
    const root = ready();
    const out = capture();
    let children = 0;
    const killing: Io = {
      ...out.io,
      runAsync: (command, args, options) => {
        if (command === "node") {
          children += 1;
        }

        if (command === "node" && children === 2) {
          throw new Error("killed");
        }

        return out.io.runAsync(command, args, options);
      },
    };

    useDescribing("sonnet", 1);

    const code = await run(
      ["describe", ORDER, STORE, "--repository", root],
      killing,
    );

    expect(code).not.toBe(0);
    expect(out.err()).toContain("killed");

    const [saved] = recorded(root);

    expect(recorded(root)).toHaveLength(1);
    expect(saved).toMatchObject({
      kind: "describe",
      outcome: "running",
      finished: null,
    });
    expect(saved.entries).toHaveLength(1);
    expect(saved.entries[0]).toMatchObject({ name: ORDER, outcome: "ok" });

    const listed = await exec(root, "log");
    const printed = await exec(root, "log", "--last");

    expect(listed.out).toContain("stopped");
    expect(printed.out).toContain("stopped: no finish recorded");
    expect(printed.out).toContain(ORDER);
  });

  it("records an unreadable program as a failed entry with no status", async () => {
    const root = repository();

    writeFileSync(
      join(root, ".recognizer/config.yaml"),
      'describer:\n  command: ["/no/such/describer", "{request}"]\n  version: "v1"\n',
    );
    await exec(root, "describe", ORDER);

    expect(recorded(root)[0].entries[0]).toMatchObject({
      status: null,
      outcome: "failed",
    });
  });

  it("records an unreadable module with an empty command", async () => {
    const root = ready();

    rmSync(join(root, ORDER));
    commitAll(root);
    await exec(root, "describe");

    const saved = recorded(root).find((one) => one.kind === "describe");

    expect(
      saved.entries.find((one: { name: string }) => one.name === ORDER),
    ).toMatchObject({
      name: ORDER,
      command: [],
      status: null,
      duration_ms: 0,
      reason: "source could not be read",
    });
  });

  it("writes nothing for --check, for nothing to do, and for a blank --by", async () => {
    const root = ready();

    await exec(root, "describe", "--check");
    expect(recorded(root)).toEqual([]);

    await exec(root, "describe");
    await exec(root, "describe");
    expect(recorded(root)).toHaveLength(1);

    expect((await exec(ready(), "describe", "--by", "  ")).code).toBe(2);
    expect(recorded(root)).toHaveLength(1);
  });
});
