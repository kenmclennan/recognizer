import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../scripts/temp-dirs.mjs";
import { nodeIo, run } from "../src/cli.js";
import { REPO } from "./helpers.js";
import { fakeIo, ROOT } from "./scan-helpers.js";

interface Case {
  name: string;
  open: unknown[];
  request: string;
  response: unknown;
}

const cases: Case[] = JSON.parse(
  readFileSync(join(REPO, "fixtures/window-socket/cases.json"), "utf8"),
);
const SOCKET = "/tmp/app.sock";

function argvOf(request: string): string[] | null {
  let body: { v?: unknown; command?: unknown; id?: unknown } | null;

  try {
    body = JSON.parse(request);
  } catch {
    return null;
  }

  if (body === null || typeof body !== "object" || body.v !== 1) {
    return null;
  }

  if (body.command === "windows") {
    return ["windows"];
  }

  if (body.command === "window" && body.id === undefined) {
    return ["window"];
  }

  return body.command === "window" && typeof body.id === "string"
    ? ["window", body.id]
    : null;
}

function asking(response: unknown) {
  return fakeIo({
    env: { RECOGNIZER_APP_SOCKET: SOCKET },
    request: () => JSON.stringify(response),
  });
}

function runWith(fake: ReturnType<typeof fakeIo>, ...argv: string[]) {
  const code = run(argv, fake.io);

  return { code, out: fake.out(), err: fake.err() };
}

const validCases = cases.filter((c) => argvOf(c.request) !== null);

describe.each(validCases.map((c) => [c.name, c] as const))("%s", (_, c) => {
  it("sends the fixture's request and maps the answer to an exit code", () => {
    const fake = asking(c.response);
    const { code, out, err } = runWith(
      fake,
      ...(argvOf(c.request) as string[]),
    );
    const response = c.response as {
      status: string;
      result?: unknown;
      reason?: string;
    };

    expect(fake.requests).toEqual([{ socket: SOCKET, text: c.request }]);

    if (response.status === "done") {
      expect(code).toBe(0);
      expect(
        JSON.parse(
          runWith(
            asking(c.response),
            ...(argvOf(c.request) as string[]),
            "--json",
          ).out,
        ),
      ).toEqual(response.result);
      expect(out).not.toBe("");
    } else {
      expect(code).toBe(1);
      expect(err).toBe(`${response.reason}\n`);
    }
  });
});

const byName = (name: string) => cases.find((c) => c.name === name) as Case;

describe("windows", () => {
  it("prints one line per window", () => {
    const { out } = runWith(
      asking(byName("windows lists open windows in number order").response),
      "windows",
    );

    expect(out).toBe(
      [
        "w-1  /r/one  view: overview  selection: module app/a.py",
        "w-2  /r/two  view: -  selection: -",
        "",
      ].join("\n"),
    );
  });

  it("says when no window is open", () => {
    expect(
      runWith(
        asking(byName("windows with none open is an empty list").response),
        "windows",
      ).out,
    ).toBe("no windows are open\n");
  });

  it("exits 1 naming the socket path when the app is not running", () => {
    const fake = fakeIo({ env: { RECOGNIZER_APP_SOCKET: SOCKET } });
    const { code, err } = runWith(fake, "windows");

    expect(code).toBe(1);
    expect(err).toBe(
      `the Recognizer app is not running (no socket at ${SOCKET})\n`,
    );
  });

  it("derives the default socket from HOME", () => {
    const fake = fakeIo({ env: { HOME: "/Users/k" } });

    runWith(fake, "windows");

    expect(fake.requests[0]?.socket).toBe(
      "/Users/k/Library/Application Support/com.kenmclennan.recognizer/app.sock",
    );
  });

  it("refuses a socket path over 100 bytes", () => {
    const long = `/${"a".repeat(120)}`;
    const fake = fakeIo({ env: { RECOGNIZER_APP_SOCKET: long } });
    const { code, err } = runWith(fake, "windows");

    expect(code).toBe(2);
    expect(err).toContain(long);
    expect(fake.requests).toEqual([]);
  });

  it("exits 2 for an argument, and for --repository", () => {
    expect(runWith(asking({}), "windows", "w-1").code).toBe(2);
    expect(runWith(asking({}), "windows", "--repository", ROOT).code).toBe(2);
  });
});

describe("window", () => {
  it("prints the window's modules, folds, focus, selection, trail and inspector tab", () => {
    const { out } = runWith(
      asking(byName("window by id").response),
      "window",
      "w-2",
    );

    expect(out).toContain("w-2  /r/two");
    expect(out).toContain("inspector: closed, tab: contents");

    const one = runWith(
      asking(byName("window with one open window needs no id").response),
      "window",
    ).out;

    expect(one).toBe(
      [
        "w-1  /r/one",
        "view: overview",
        "modules: 2",
        "  app/a.py",
        "  app/b.py",
        "folded: 1",
        "  app/util",
        "focus: app",
        "selection: module app/a.py",
        "trail: 2",
        "  module app/a.py  tab: dependencies",
        "  module app/b.py  uses  tab: dependencies  (active)",
        "inspector: open, tab: dependencies",
        "",
      ].join("\n"),
    );
  });

  it("says to pass an id when two windows are open", () => {
    const { code, err } = runWith(
      asking(byName("window with two open and no id asks for one").response),
      "window",
    );

    expect(code).toBe(1);
    expect(err).toContain("pass an id");
    expect(err).toContain("w-1, w-2");
  });

  it("exits 1 when the app is not running", () => {
    expect(
      runWith(fakeIo({ env: { RECOGNIZER_APP_SOCKET: SOCKET } }), "window")
        .code,
    ).toBe(1);
  });

  it("exits 2 for two ids", () => {
    expect(runWith(asking({}), "window", "w-1", "w-2").code).toBe(2);
  });
});

describe("views new --from-window", () => {
  const VIEWS = `${ROOT}/.recognizer/views`;
  const CACHE = `${ROOT}/.recognizer/cache/scan.python.json`;
  const fixture = JSON.parse(
    readFileSync(join(REPO, "fixtures/python/expected-scan.json"), "utf8"),
  );

  function repository(state: Record<string, unknown>) {
    const response = JSON.stringify({
      v: 1,
      status: "done",
      result: {
        id: "w-1",
        folder: ROOT,
        view: "overview",
        modules: [],
        folded: [],
        focus: null,
        selection: { kind: "module", id: "shop/domain/order.py" },
        trail: [
          {
            selection: { kind: "module", id: "x" },
            relation: null,
            tab: "contents",
            active: true,
          },
        ],
        inspector: { open: true, tab: "findings" },
        ...state,
      },
    });

    return fakeIo({
      commit: "abc123",
      env: { RECOGNIZER_APP_SOCKET: SOCKET },
      request: () => response,
      files: {
        [`${ROOT}/shop/a.py`]: "",
        [CACHE]: JSON.stringify({
          ...fixture,
          commit: "abc123",
          modified: false,
          files: [],
        }),
      },
    });
  }

  function create(fake: ReturnType<typeof fakeIo>) {
    return runWith(
      fake,
      "views",
      "new",
      "mine",
      "--description",
      "From a window",
      "--from-window",
      "w-1",
      "--repository",
      ROOT,
    );
  }

  it("saves sorted picks, sorted folds and one focus, and nothing else", () => {
    const fake = repository({
      modules: ["shop/domain/order.py", "shop/application/place.py"],
      folded: ["shop/domain", "shop/application"],
      focus: "shop",
    });
    const { code, out } = create(fake);
    const saved = JSON.parse(fake.files.get(`${VIEWS}/mine.json`) as string);

    expect(code).toBe(0);
    expect(out).toBe("mine: created; 5 steps, resolves to 2 modules\n");
    expect(fake.requests).toEqual([
      { socket: SOCKET, text: '{"v":1,"command":"window","id":"w-1"}' },
    ]);
    expect(saved).toEqual({
      schema_version: 2,
      description: "From a window",
      commit: "abc123",
      steps: [
        { kind: "pick", module: "shop/application/place.py" },
        { kind: "pick", module: "shop/domain/order.py" },
        { kind: "fold", folder: "shop/application" },
        { kind: "fold", folder: "shop/domain" },
        { kind: "focus", folder: "shop" },
      ],
    });
    expect(JSON.stringify(saved)).not.toContain("selection");
  });

  it("saves a window whose folded folder is a compacted one unchanged", () => {
    const fake = repository({
      modules: ["shop/domain/order.py"],
      folded: ["shop/domain"],
    });

    create(fake);

    expect(
      JSON.parse(fake.files.get(`${VIEWS}/mine.json`) as string).steps,
    ).toContainEqual({ kind: "fold", folder: "shop/domain" });
  });

  it("exits 2 when the window shows another folder", () => {
    const fake = repository({ folder: "/elsewhere" });
    const { code, err } = create(fake);

    expect(code).toBe(2);
    expect(err).toBe(`w-1 shows /elsewhere, not ${ROOT}\n`);
    expect(fake.files.has(`${VIEWS}/mine.json`)).toBe(false);
  });

  it("exits 2 naming a module the scan no longer has", () => {
    const fake = repository({ modules: ["shop/gone.py"] });
    const { code, err } = create(fake);

    expect(code).toBe(2);
    expect(err).toContain("no such module: shop/gone.py");
    expect(fake.files.has(`${VIEWS}/mine.json`)).toBe(false);
  });

  it("exits 2 with the app's reason when it refuses", () => {
    const fake = fakeIo({
      env: { RECOGNIZER_APP_SOCKET: SOCKET },
      request: () =>
        JSON.stringify({
          v: 1,
          status: "refused",
          reason: "no window w-1; no window is open",
        }),
    });
    const { code, err } = create(fake);

    expect(code).toBe(2);
    expect(err).toBe("no window w-1; no window is open\n");
  });

  it("exits 2 when the app is not running", () => {
    const { code, err } = create(
      fakeIo({ env: { RECOGNIZER_APP_SOCKET: SOCKET } }),
    );

    expect(code).toBe(2);
    expect(err).toContain("the Recognizer app is not running");
  });
});

describe("nodeIo.request against a real socket", () => {
  function serve(script: string) {
    const directory = makeTempDir("rec-sock-");
    const socket = join(directory, "s");
    const child = spawn(process.execPath, ["-e", script, socket], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    const ready = new Promise<void>((resolve) => {
      child.stdout.once("data", () => resolve());
    });

    return { socket, child, ready };
  }

  const ECHO = `
    const net = require("net");
    const server = net.createServer((c) => {
      let b = "";
      c.on("data", (d) => {
        b += d;
        if (b.includes("\\n")) c.end(JSON.stringify({ v: 1, status: "done", result: b.trim() }) + "\\n");
      });
    });
    server.listen(process.argv[1], () => process.stdout.write("ready"));
  `;

  const SILENT = `
    const net = require("net");
    const server = net.createServer(() => {});
    server.listen(process.argv[1], () => process.stdout.write("ready"));
  `;

  it("sends one line and reads one line back", async () => {
    const { socket, child, ready } = serve(ECHO);

    await ready;

    try {
      const reply = await new Promise<
        ReturnType<ReturnType<typeof nodeIo>["request"]>
      >((resolve) => {
        setImmediate(() =>
          resolve(nodeIo().request(socket, '{"v":1,"command":"windows"}')),
        );
      });

      expect(reply.connected).toBe(true);
      expect(JSON.parse(reply.response).result).toBe(
        '{"v":1,"command":"windows"}',
      );
    } finally {
      child.kill();
    }
  });

  it("reports not connected when nothing listens", () => {
    const reply = nodeIo().request(
      join(makeTempDir("rec-sock-"), "none"),
      "{}",
    );

    expect(reply.connected).toBe(false);
    expect(reply.message).not.toBe("");
  });

  it("gives up on a server that never replies", async () => {
    const { socket, child, ready } = serve(SILENT);

    await ready;

    try {
      const reply = nodeIo().request(socket, "{}");

      expect(reply.connected).toBe(false);
    } finally {
      child.kill();
    }
  }, 20000);
});
