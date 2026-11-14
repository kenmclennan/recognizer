import { spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { createConnection } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const LAUNCH_SERVICES =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
const CHECK_PREFIX = "com.kenmclennan.recognizer-open-check";

export const OPEN_COUNT = 10;
export const DEFAULT_TIMEOUT_MS = 45000;
export const POLL_MS = 250;
export const MAX_SOCKET_BYTES = 100;
export const FIXTURE = "fixtures/python/sample";

export function guardIdentifier(id) {
  if (
    typeof id !== "string" ||
    id === "com.kenmclennan.recognizer" ||
    !id.startsWith(CHECK_PREFIX)
  ) {
    throw new Error(`refusing to use the identifier "${id}" for an open check`);
  }

  return id;
}

export function checkIdentifier(pid = process.pid) {
  return guardIdentifier(`${CHECK_PREFIX}-${pid}`);
}

export function ownFolders(id, home = homedir()) {
  guardIdentifier(id);

  return [
    join(home, "Library", "Application Support", id),
    join(home, "Library", "WebKit", id),
    join(home, "Library", "Caches", id),
    join(home, "Library", "HTTPStorages", id),
    join(home, "Library", "Saved Application State", `${id}.savedState`),
    join(home, "Library", "Preferences", `${id}.plist`),
  ];
}

export function windowAnswer(line) {
  const parsed = JSON.parse(line);

  if (parsed.status === "done") {
    return { status: "done", result: parsed.result };
  }

  return { status: "refused", reason: String(parsed.reason ?? "no reason") };
}

function sameFolder(left, right) {
  const real = (path) => {
    try {
      return realpathSync(path);
    } catch {
      return path;
    }
  };

  return real(left) === real(right);
}

export async function runOpens({
  count,
  folder,
  launch,
  ask,
  now,
  wait,
  timeoutMs,
}) {
  const opens = [];

  for (let n = 1; n <= count; n += 1) {
    const handle = await launch();
    const started = now();
    let reason = "the window never answered";
    let passed = false;

    try {
      for (;;) {
        let answer;

        try {
          answer = await ask();
        } catch (error) {
          answer = { status: "refused", reason: error.message };
        }

        if (answer.status === "done") {
          if (sameFolder(answer.result?.folder ?? "", folder)) {
            passed = true;
            break;
          }

          reason = `the window shows ${answer.result?.folder}, not ${folder}`;
        } else {
          reason = answer.reason;
        }

        if (now() - started >= timeoutMs) {
          break;
        }

        await wait(POLL_MS);
      }
    } finally {
      await handle.stop();
    }

    if (!passed) {
      return { ok: false, failedOpen: n, reason, opens };
    }

    opens.push({ open: n, elapsedMs: now() - started });
  }

  return { ok: true, opens };
}

export function askSocket(path) {
  return new Promise((resolveAnswer, reject) => {
    const socket = createConnection(path);
    let data = "";

    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(`${JSON.stringify({ v: 1, command: "window" })}\n`);
    });
    socket.on("data", (chunk) => {
      data += chunk;

      if (data.includes("\n")) {
        socket.end();

        try {
          resolveAnswer(windowAnswer(data.split("\n")[0]));
        } catch (error) {
          reject(error);
        }
      }
    });
    socket.on("error", reject);
    socket.on("close", () => {
      if (!data.includes("\n")) {
        reject(new Error("the socket closed without an answer"));
      }
    });
  });
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited ${result.status}: ${result.stderr}`,
    );
  }

  return result.stdout;
}

class Precondition extends Error {}

function parseArguments(argv) {
  const options = { toolchain: null, timeoutMs: DEFAULT_TIMEOUT_MS };

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--toolchain") {
      i += 1;
      options.toolchain = argv[i];
    } else if (argv[i] === "--timeout") {
      i += 1;
      options.timeoutMs = Number(argv[i]) * 1000;
    } else {
      throw new Precondition(`unknown argument ${argv[i]}`);
    }
  }

  if (!options.toolchain) {
    throw new Precondition("pass --toolchain <built toolchain folder>");
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Precondition("--timeout takes a positive number of seconds");
  }

  return options;
}

function checkPreconditions(toolchain) {
  if (!existsSync(join(toolchain, "commands"))) {
    throw new Precondition(
      `${toolchain} is not a built toolchain folder; run node scripts/build-toolchain.mjs <dir>`,
    );
  }

  if (!existsSync(join(REPO, "app", "dist"))) {
    throw new Precondition(
      "app/dist is missing; run npm run build -w @recognizer/app",
    );
  }

  const shell = process.env.SHELL ?? "/bin/zsh";
  const out = run(shell, [
    "-ilc",
    "echo RESULT=$(command -v recognizer-scan-python)",
  ]);
  const line = out.split("\n").find((one) => one.startsWith("RESULT="));

  if (!line || line === "RESULT=") {
    throw new Precondition(
      "recognizer-scan-python is not on the login shell's PATH; install the recognizer-plugins bundle",
    );
  }
}

function buildBundle(id, toolchain) {
  run(
    "npm",
    [
      "run",
      "tauri",
      "-w",
      "@recognizer/app",
      "--",
      "build",
      "--bundles",
      "app",
      "--target",
      "aarch64-apple-darwin",
      "--config",
      JSON.stringify({ identifier: id }),
    ],
    { cwd: REPO, stdio: ["ignore", "inherit", "inherit"] },
  );

  const macos = join(
    REPO,
    "app/src-tauri/target/aarch64-apple-darwin/release/bundle/macos",
  );
  const bundles = readdirSync(macos).filter((name) => name.endsWith(".app"));

  if (bundles.length !== 1) {
    throw new Error(`expected one .app in ${macos}, found ${bundles.length}`);
  }

  const bundle = join(macos, bundles[0]);

  copyToolchain(toolchain, join(bundle, "Contents/Resources/toolchain"));
  run("codesign", ["--force", "--deep", "--sign", "-", bundle]);
  run("codesign", ["--verify", "--deep", "--strict", bundle]);

  return bundle;
}

export function copyToolchain(source, destination) {
  cpSync(source, destination, { recursive: true, verbatimSymlinks: true });
}

function prepareFixture(parent, toolchain) {
  const copy = join(parent, "repo");

  cpSync(join(REPO, FIXTURE), copy, { recursive: true });
  run("git", ["init", "-q"], { cwd: copy });
  run("git", ["add", "-A"], { cwd: copy });
  run(
    "git",
    [
      "-c",
      "user.name=open-check",
      "-c",
      "user.email=open-check@example.invalid",
      "commit",
      "-q",
      "-m",
      "fixture",
    ],
    { cwd: copy },
  );

  const recognizer = join(toolchain, "commands", "recognizer");
  const scan = () => run(recognizer, ["scan", copy, "--json"]);

  scan();

  const events = scan()
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line));

  if (!events.some((e) => e.phase === "extract" && e.state === "current")) {
    throw new Precondition("the second scan of the fixture was not current");
  }

  return copy;
}

function launcher({ executable, folder, socket }) {
  return async () => {
    const child = spawn(executable, [folder], {
      env: { ...process.env, RECOGNIZER_APP_SOCKET: socket },
      stdio: "ignore",
    });
    const exited = new Promise((done) => child.once("exit", done));

    return {
      async stop() {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGTERM");

          const timer = setTimeout(() => child.kill("SIGKILL"), 20000);

          await exited;
          clearTimeout(timer);
        }

        for (let i = 0; i < 80 && existsSync(socket); i += 1) {
          await sleep(250);
        }
      },
    };
  };
}

export async function main(argv) {
  const options = parseArguments(argv);
  const toolchain = resolve(options.toolchain);

  checkPreconditions(toolchain);

  const id = checkIdentifier();
  const parent = mkdtempSync(join(tmpdir(), "oc-"));
  const socket = join(parent, "a.sock");
  let bundle = null;

  if (Buffer.byteLength(socket) > MAX_SOCKET_BYTES) {
    throw new Precondition(
      `the socket path ${socket} is over ${MAX_SOCKET_BYTES} bytes`,
    );
  }

  try {
    process.stdout.write(`open check identifier ${id}\nsocket ${socket}\n`);

    const folder = prepareFixture(parent, toolchain);

    bundle = buildBundle(id, toolchain);

    const name = run("plutil", [
      "-extract",
      "CFBundleExecutable",
      "raw",
      join(bundle, "Contents/Info.plist"),
    ]).trim();
    const result = await runOpens({
      count: OPEN_COUNT,
      folder,
      launch: launcher({
        executable: join(bundle, "Contents/MacOS", name),
        folder,
        socket,
      }),
      ask: () => askSocket(socket),
      now: () => Date.now(),
      wait: sleep,
      timeoutMs: options.timeoutMs,
    });

    for (const one of result.opens) {
      process.stdout.write(
        `open ${one.open} drew the explorer in ${one.elapsedMs} ms\n`,
      );
    }

    if (!result.ok) {
      process.stderr.write(
        `open ${result.failedOpen} failed: ${result.reason}\n`,
      );

      return 1;
    }

    process.stdout.write(
      `${result.opens.length} of ${OPEN_COUNT} opens passed\n`,
    );

    return 0;
  } finally {
    if (bundle) {
      spawnSync(LAUNCH_SERVICES, ["-u", bundle]);
      rmSync(bundle, { recursive: true, force: true });
    }

    for (const folder of ownFolders(id)) {
      rmSync(folder, { recursive: true, force: true });
    }

    rmSync(parent, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write(`${error.message}\n`);
      process.exit(error instanceof Precondition ? 2 : 1);
    },
  );
}
