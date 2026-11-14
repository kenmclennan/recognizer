import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  askSocket,
  copyToolchain,
  guardIdentifier,
  MAX_SOCKET_BYTES,
  ownFolders,
  runOpens,
  windowAnswer,
} from "./open-check.mjs";
import { makeTempDir } from "./temp-dirs.mjs";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const FOLDER = "/r/fixture";

function clock() {
  let time = 0;

  return {
    now: () => time,
    wait: async (ms) => {
      time += ms;
    },
  };
}

function harness(answers) {
  const counts = { launch: 0, stop: 0 };
  const asked = [];

  return {
    counts,
    asked,
    launch: async () => {
      counts.launch += 1;

      return {
        stop: async () => {
          counts.stop += 1;
        },
      };
    },
    ask: async () => {
      const answer = answers(counts.launch, asked.length);

      asked.push(answer);

      return answer;
    },
  };
}

const done = { status: "done", result: { folder: FOLDER } };
const refused = {
  status: "refused",
  reason: "w-1 has not finished opening",
};

function run(rig, overrides = {}) {
  return runOpens({
    count: 10,
    folder: FOLDER,
    launch: rig.launch,
    ask: rig.ask,
    timeoutMs: 45000,
    ...clock(),
    ...overrides,
  });
}

describe("runOpens", () => {
  it("passes when all ten opens answer done on the first poll", async () => {
    const rig = harness(() => done);
    const result = await run(rig);

    expect(result.ok).toBe(true);
    expect(result.opens).toHaveLength(10);
    expect(rig.counts).toEqual({ launch: 10, stop: 10 });
  });

  it("stops at the first open that never draws and runs no later open", async () => {
    const rig = harness((launch) => (launch === 4 ? refused : done));
    const result = await run(rig);

    expect(result.ok).toBe(false);
    expect(result.failedOpen).toBe(4);
    expect(result.reason).toContain("has not finished opening");
    expect(rig.counts).toEqual({ launch: 4, stop: 4 });
  });

  it("passes an open that is refused twice and then done, with the fake clock's time", async () => {
    let calls = 0;
    const rig = harness(() => {
      calls += 1;

      return calls <= 2 ? refused : done;
    });
    const result = await run(rig, { count: 1 });

    expect(result.ok).toBe(true);
    expect(result.opens).toEqual([{ open: 1, elapsedMs: 500 }]);
  });

  it("fails an open whose window shows a different folder", async () => {
    const rig = harness(() => ({
      status: "done",
      result: { folder: "/r/other" },
    }));
    const result = await run(rig);

    expect(result.ok).toBe(false);
    expect(result.failedOpen).toBe(1);
    expect(result.reason).toContain("/r/other");
  });

  it("reports the nine earlier opens when the tenth fails", async () => {
    const rig = harness((launch) => (launch === 10 ? refused : done));
    const result = await run(rig);

    expect(result.ok).toBe(false);
    expect(result.failedOpen).toBe(10);
    expect(result.opens).toHaveLength(9);
  });

  it("counts a socket error as a refusal and keeps polling", async () => {
    let calls = 0;
    const rig = harness(() => done);

    rig.ask = async () => {
      calls += 1;

      if (calls === 1) {
        throw new Error("connect ENOENT");
      }

      return done;
    };

    const result = await run(rig, { count: 1 });

    expect(result.ok).toBe(true);
  });
});

describe("guardIdentifier", () => {
  it("refuses the production identifier, a review identifier and an empty one", () => {
    expect(() => guardIdentifier("com.kenmclennan.recognizer")).toThrow();
    expect(() =>
      guardIdentifier("com.kenmclennan.recognizer-review564"),
    ).toThrow();
    expect(() => guardIdentifier("")).toThrow();
  });

  it("accepts a check identifier", () => {
    expect(guardIdentifier("com.kenmclennan.recognizer-open-check-4242")).toBe(
      "com.kenmclennan.recognizer-open-check-4242",
    );
  });

  it("derives folders that are the check's own and never the production ones", () => {
    const id = "com.kenmclennan.recognizer-open-check-4242";
    const folders = ownFolders(id);
    const production = [
      join(
        homedir(),
        "Library",
        "Application Support",
        "com.kenmclennan.recognizer",
      ),
      join(homedir(), "Library", "WebKit", "com.kenmclennan.recognizer"),
    ];

    for (const folder of folders) {
      expect(folder).toContain(id);

      for (const path of production) {
        expect(folder === path || folder.startsWith(`${path}/`)).toBe(false);
      }
    }
  });
});

describe("windowAnswer", () => {
  const cases = JSON.parse(
    readFileSync(join(REPO, "fixtures/window-socket/cases.json"), "utf8"),
  ).filter((one) => one.request.startsWith('{"v":1,"command":"window"'));

  it("parses every window reply in the shared socket cases", () => {
    expect(cases.length).toBeGreaterThan(0);

    for (const one of cases) {
      const answer = windowAnswer(JSON.stringify(one.response));

      if (one.response.status === "done") {
        expect(answer).toEqual({ status: "done", result: one.response.result });
      } else {
        expect(answer).toEqual({
          status: "refused",
          reason: one.response.reason,
        });
      }
    }
  });
});

describe("askSocket", () => {
  it("returns a real socket's answers in order", async () => {
    const path = join(makeTempDir("oc-test-"), "a.sock");

    expect(Buffer.byteLength(path)).toBeLessThanOrEqual(MAX_SOCKET_BYTES);

    const replies = [
      '{"v":1,"status":"refused","reason":"w-1 has not finished opening"}\n',
      '{"v":1,"status":"refused","reason":"w-1 has not finished opening"}\n',
      `{"v":1,"status":"done","result":{"folder":"${FOLDER}"}}\n`,
    ];
    const requests = [];
    const server = createServer((connection) => {
      connection.on("data", (chunk) => {
        requests.push(chunk.toString());
        connection.write(replies[requests.length - 1]);
      });
    });

    await new Promise((ready) => server.listen(path, ready));

    try {
      const answers = [
        await askSocket(path),
        await askSocket(path),
        await askSocket(path),
      ];

      expect(answers).toEqual([
        { status: "refused", reason: "w-1 has not finished opening" },
        { status: "refused", reason: "w-1 has not finished opening" },
        { status: "done", result: { folder: FOLDER } },
      ]);
      expect(requests[0]).toBe('{"v":1,"command":"window"}\n');
    } finally {
      await new Promise((closed) => server.close(closed));
    }
  });
});

describe("the fixture", () => {
  it("is 17 committed files", () => {
    const listed = execFileSync("git", ["ls-files", "fixtures/python/sample"], {
      cwd: REPO,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);

    expect(listed).toHaveLength(17);
  });
});

describe("copyToolchain", () => {
  it("keeps a relative symlink relative", () => {
    const root = makeTempDir("open-check-copy-");
    const source = join(root, "toolchain");

    mkdirSync(join(source, "commands"), { recursive: true });
    mkdirSync(join(source, "bin"));
    writeFileSync(join(source, "bin", "recognizer"), "x");
    symlinkSync("../bin/recognizer", join(source, "commands", "recognizer"));

    const destination = join(root, "copy");

    copyToolchain(source, destination);

    expect(readlinkSync(join(destination, "commands", "recognizer"))).toBe(
      "../bin/recognizer",
    );
  });
});
