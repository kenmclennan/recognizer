import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../scripts/temp-dirs.mjs";
import { run } from "../src/cli.js";
import { capture, REPO } from "./helpers.js";

const FAKE = join(REPO, "check/test/fixtures/fake-describer.mjs");
const BIN = join(REPO, "check/dist/bin.js");
const ORDER = "shop/domain/order.py";
const STORE = "shop/ports/store.py";
const PLACE = "shop/application/place.py";
const CUSTOMER = "shop/domain/customer.py";
const children: ChildProcess[] = [];
const traced: string[] = [];
const holdings: string[] = [];

function hold(): string {
  const directory = makeTempDir("recognizer-hold-");

  holdings.push(directory);

  return directory;
}

function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
}

function repository(...flags: string[]): string {
  const root = makeTempDir("recognizer-describe-concurrent-");

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
  configure(root, ...flags);

  return root;
}

function configure(root: string, ...flags: string[]): void {
  const command = [
    "node",
    FAKE,
    "{repository}",
    ...flags,
    "--model",
    "{model}",
    "{request}",
  ];

  writeFileSync(
    join(root, ".recognizer/config.yaml"),
    `describer:\n  command: ${JSON.stringify(command)}\n  version: "v1"\n`,
  );
}

function useDescribing(model: string, batchSize: number): void {
  writeFileSync(
    join(process.env.RECOGNIZER_APP_CONFIG_DIR as string, "config.json"),
    JSON.stringify({ describing: { model, batch_size: batchSize } }),
  );
}

function trace(root: string): { kind: string; module: string; pid: number }[] {
  const file = join(root, ".recognizer/cache/describer-concurrency.log");

  if (!traced.includes(root)) {
    traced.push(root);
  }

  if (!existsSync(file)) {
    return [];
  }

  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [kind, module, pid] = line.split(" ") as [string, string, string];

      return { kind, module, pid: Number(pid) };
    });
}

function starts(root: string): number {
  return trace(root).filter((one) => one.kind === "start").length;
}

function ends(root: string): number {
  return trace(root).filter((one) => one.kind === "end").length;
}

function peak(root: string): number {
  let running = 0;
  let most = 0;

  for (const one of trace(root)) {
    running += one.kind === "start" ? 1 : -1;
    most = Math.max(most, running);
  }

  return most;
}

async function until(test: () => boolean): Promise<void> {
  const deadline = Date.now() + 20_000;

  while (!test()) {
    if (Date.now() > deadline) {
      throw new Error("condition was not reached");
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function release(directory: string, name: string): void {
  writeFileSync(join(directory, `release-${name.split("/").join("_")}`), "");
}

function responsibilities(root: string) {
  return JSON.parse(
    readFileSync(join(root, ".recognizer/responsibilities.json"), "utf8"),
  );
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}

function launch(root: string, detached = false, scratch?: string) {
  const child = spawn(
    process.execPath,
    [BIN, "describe", "--all", "--repository", root],
    {
      detached,
      env: scratch ? { ...process.env, TMPDIR: scratch } : process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const closed = new Promise<number | null>((resolve) => {
    child.on("close", (code) => resolve(code));
  });

  children.push(child);

  return { child, closed };
}

beforeEach(() => {
  useDescribing("sonnet", 4);
});

afterEach(() => {
  for (const directory of holdings.splice(0)) {
    writeFileSync(join(directory, "release-all"), "");
  }

  for (const child of children.splice(0)) {
    child.kill("SIGKILL");
  }

  for (const root of [...traced]) {
    for (const one of trace(root)) {
      try {
        process.kill(one.pid, "SIGKILL");
      } catch {
        alive(one.pid);
      }
    }
  }

  traced.length = 0;
});

describe("concurrent describe", () => {
  it("keeps exactly four describers in flight over fifteen modules", async () => {
    const holding = hold();
    const root = repository("--hold", holding);
    const out = capture();
    const finished = run(["describe", "--all", "--repository", root], out.io);

    await until(() => starts(root) === 4);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(starts(root)).toBe(4);

    writeFileSync(join(holding, "release-all"), "");

    expect(await finished).toBe(0);
    expect(starts(root)).toBe(15);
    expect(peak(root)).toBe(4);
  });

  it("streams entries in finish order and sorts the summary by id", async () => {
    const holding = hold();
    const root = repository("--hold", holding);
    const out = capture();
    const finished = run(
      ["describe", ORDER, STORE, "--repository", root],
      out.io,
    );

    await until(() => starts(root) === 2);
    release(holding, STORE);
    await until(() => out.out().includes(`described ${STORE}`));

    expect(out.out()).not.toContain(`described ${ORDER}`);

    release(holding, ORDER);

    expect(await finished).toBe(0);
    expect(out.out().indexOf(`described ${STORE}`)).toBeLessThan(
      out.out().indexOf(`described ${ORDER}`),
    );
  });

  it("lists described and failed in id order whatever the finish order", async () => {
    const holding = hold();
    const root = repository("--hold", holding);
    const out = capture();
    const finished = run(
      ["describe", ORDER, STORE, "--json", "--repository", root],
      out.io,
    );

    await until(() => starts(root) === 2);
    release(holding, STORE);
    await until(() => ends(root) === 1);
    release(holding, ORDER);
    await finished;

    expect(JSON.parse(out.out()).described).toEqual([ORDER, STORE]);
  });

  it("does not stop the others when one module fails", async () => {
    const root = repository("--fail", STORE);
    const out = capture();
    const code = await run(
      [
        "describe",
        ORDER,
        STORE,
        PLACE,
        CUSTOMER,
        "--json",
        "--repository",
        root,
      ],
      out.io,
    );
    expect(out.err()).not.toContain("no such module");

    const parsed = JSON.parse(out.out());

    expect(code).toBe(1);
    expect(parsed.described).toEqual([PLACE, CUSTOMER, ORDER]);
    expect(parsed.failed).toEqual([
      { module: STORE, reason: `cannot describe ${STORE}` },
    ]);
    expect(out.err()).toContain(`failed ${STORE}: cannot describe ${STORE}`);
    expect(Object.keys(responsibilities(root).modules).sort()).toEqual([
      PLACE,
      CUSTOMER,
      ORDER,
    ]);
  });

  it("holds every line in a valid file after a concurrent run", async () => {
    const root = repository("--sleep", "20");
    const out = capture();

    expect(await run(["describe", "--all", "--repository", root], out.io)).toBe(
      0,
    );
    expect(Object.keys(responsibilities(root).modules)).toHaveLength(15);
    expect(
      readdirSync(join(root, ".recognizer")).filter((name) =>
        name.endsWith(".tmp"),
      ),
    ).toEqual([]);
    expect(peak(root)).toBeLessThanOrEqual(4);
  });

  it("holds exactly the completed entries when the process is killed after the first", async () => {
    const holding = hold();
    const root = repository("--hold", holding);
    const { child, closed } = launch(root);

    await until(() => starts(root) === 4);

    const first = (trace(root)[0] as { module: string }).module;

    release(holding, first);
    await until(() =>
      existsSync(join(root, ".recognizer/responsibilities.json")),
    );
    child.kill("SIGTERM");

    expect(await closed).toBe(143);
    expect(Object.keys(responsibilities(root).modules)).toEqual([first]);
  });

  it.each([
    ["the CLI", false],
    ["its process group", true],
  ])("leaves no describer running after SIGTERM to %s", async (_, group) => {
    const holding = hold();
    const root = repository("--hold", holding);
    const { child, closed } = launch(root, group);

    await until(() => starts(root) === 4);

    const pids = trace(root).map((one) => one.pid);

    if (group) {
      process.kill(-(child.pid as number), "SIGTERM");
    } else {
      child.kill("SIGTERM");
    }

    expect(await closed).toBe(143);
    await until(() => pids.every((pid) => !alive(pid)));
  });

  it("leaves no describer running after SIGKILL to the CLI", async () => {
    const holding = hold();
    const root = repository("--hold", holding);
    const { child, closed } = launch(
      root,
      false,
      makeTempDir("recognizer-scratch-"),
    );

    await until(() => starts(root) === 4);

    const pids = trace(root).map((one) => one.pid);

    child.kill("SIGKILL");
    await closed;
    await until(() => pids.every((pid) => !alive(pid)));
  });

  it("exits non-zero by itself when a held describer is never released", async () => {
    const holding = hold();
    const root = makeTempDir("recognizer-cap-");
    const request = join(root, "request.json");

    writeFileSync(request, JSON.stringify({ module: ORDER }));

    const child = spawn(
      "node",
      [FAKE, root, "--hold", holding, "--cap", "300", request],
      { stdio: "ignore" },
    );

    children.push(child);

    const code = await new Promise<number | null>((resolve) =>
      child.once("close", resolve),
    );

    expect(code).toBe(1);
  });
});

describe("the model marks lines out of date", () => {
  async function check(root: string) {
    const out = capture();

    await run(["describe", "--check", "--json", "--repository", root], out.io);

    return JSON.parse(out.out());
  }

  it("rewrites every line after the model changes", async () => {
    const root = repository();

    await run(["describe", "--all", "--repository", root], capture().io);
    useDescribing("opus", 4);

    const parsed = await check(root);

    expect(parsed.counts.outOfDate).toBe(0);
    expect(parsed.ok).toBe(true);
    expect(responsibilities(root).modules[ORDER].version).toBe("v1");

    await run(["describe", "--repository", root], capture().io);

    expect((await check(root)).ok).toBe(true);
    expect(responsibilities(root).modules[ORDER].version).toBe("v1");
  });

  it("leaves lines current for a describer that ignores the model", async () => {
    const root = repository();

    writeFileSync(
      join(root, ".recognizer/config.yaml"),
      `describer:\n  command: ["node", ${JSON.stringify(FAKE)}, "{repository}", "{request}"]\n  version: "v1"\n`,
    );
    await run(["describe", "--all", "--repository", root], capture().io);
    useDescribing("opus", 4);

    expect((await check(root)).ok).toBe(true);
  });

  it("reports only the lines written by the other model", async () => {
    const root = repository();

    await run(["describe", ORDER, STORE, "--repository", root], capture().io);
    useDescribing("opus", 4);
    await run(["describe", PLACE, "--repository", root], capture().io);

    const parsed = await check(root);
    const old = parsed.modules
      .filter((one: { status: string }) => one.status === "out-of-date")
      .map((one: { module: string }) => one.module);

    expect(old).toEqual([]);
  });

  it("passes the configured model on the describer's command line", async () => {
    const root = repository();

    useDescribing("opus", 1);
    await run(["describe", ORDER, "--repository", root], capture().io);

    const directory = join(root, ".recognizer/cache/log");
    const record = JSON.parse(
      readFileSync(
        join(directory, readdirSync(directory)[0] as string),
        "utf8",
      ),
    );

    expect(record.entries[0].command).toContain("opus");
    expect(record.entries[0].command).not.toContain("{model}");
  });
});
