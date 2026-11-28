import { describe, expect, it } from "vitest";
import type { Io, Running, RunResult } from "../../src/cli.js";

export type ProcessBehaviour =
  | { kind: "exit"; status: number; stdout: string; stderr: string }
  | { kind: "echo-stdin" }
  | { kind: "hold" }
  | { kind: "stubborn" }
  | { kind: "mark"; file: string };

export type SocketBehaviour =
  | "echo"
  | "multi"
  | "close"
  | "empty"
  | "unterminated";

export interface IoProcessesSubject {
  io: Io;
  directory: string;
  program(name: string, behaviour: ProcessBehaviour): string;
  serve(behaviour: SocketBehaviour): Promise<string>;
  elapse(ms: number): Promise<void>;
  dispose(): void;
}

interface Case {
  member: string;
  title: string;
  run: (s: IoProcessesSubject) => Promise<void>;
}

const MAX_WAITS = 100;

function exit(status: number, stdout = "", stderr = ""): ProcessBehaviour {
  return { kind: "exit", status, stdout, stderr };
}

function track(running: Running): {
  settled(): boolean;
  result: Promise<RunResult>;
} {
  let done = false;
  const result = running.result.then((value) => {
    done = true;

    return value;
  });

  return { settled: () => done, result };
}

async function until(
  s: IoProcessesSubject,
  condition: () => boolean,
  step = 50,
): Promise<void> {
  for (let index = 0; index < MAX_WAITS && !condition(); index += 1) {
    await s.elapse(step);
  }

  expect(condition()).toBe(true);
}

async function startStubborn(s: IoProcessesSubject, options = {}) {
  const lines: string[] = [];
  const running = s.io.runAsync(
    s.program("stubborn", { kind: "stubborn" }),
    [],
    {
      ...options,
      onStdoutLine: (line) => {
        lines.push(line);
      },
    },
  );
  const tracked = track(running);

  await until(s, () => lines.includes("ready") || tracked.settled());

  expect(lines).toContain("ready");

  return { running, tracked };
}

const CASES: Case[] = [
  {
    member: "run",
    title: "returns status, stdout and stderr of a program",
    run: async (s) => {
      const failing = s.io.run(s.program("failing", exit(3, "out", "err")), []);

      expect(failing).toMatchObject({
        started: true,
        status: 3,
        stdout: "out",
        stderr: "err",
      });

      expect(s.io.run(s.program("quiet", exit(0)), [])).toMatchObject({
        started: true,
        status: 0,
        stdout: "",
        stderr: "",
      });
    },
  },
  {
    member: "run",
    title: "a program that is not there reports started false and names ENOENT",
    run: async (s) => {
      const result = s.io.run(`${s.directory}/missing`, []);

      expect(result.started).toBe(false);
      expect(result.status).toBeNull();
      expect(result.stderr).toContain("ENOENT");
    },
  },
  {
    member: "run",
    title: "a program that outlives its timeout is timedOut with status 124",
    run: async (s) => {
      const result = s.io.run(s.program("hold", { kind: "hold" }), [], {
        timeoutMs: 300,
      });

      expect(result.started).toBe(true);
      expect(result.timedOut).toBe(true);
      expect(result.status).toBe(124);
    },
  },
  {
    member: "run",
    title: "a program that finishes inside its timeout is not timedOut",
    run: async (s) => {
      const result = s.io.run(s.program("quick", exit(3, "out", "err")), [], {
        timeoutMs: 5000,
      });

      expect(result.timedOut).toBeUndefined();
      expect(result).toMatchObject({ status: 3, stdout: "out", stderr: "err" });
    },
  },
  {
    member: "runAsync",
    title: "resolves with status, stdout and stderr",
    run: async (s) => {
      const result = await s.io.runAsync(
        s.program("failing", exit(3, "out", "err")),
        [],
      ).result;

      expect(result).toMatchObject({
        started: true,
        status: 3,
        stdout: "out",
        stderr: "err",
      });
    },
  },
  {
    member: "runAsync",
    title: "a program that is not there reports started false and names ENOENT",
    run: async (s) => {
      const result = await s.io.runAsync(`${s.directory}/missing`, []).result;

      expect(result.started).toBe(false);
      expect(result.status).toBeNull();
      expect(result.stderr).toContain("ENOENT");
    },
  },
  {
    member: "runAsync",
    title: "feeds input to stdin, and nothing without input",
    run: async (s) => {
      const command = s.program("cat", { kind: "echo-stdin" });
      const fed = await s.io.runAsync(command, [], { input: "hello" }).result;
      const unfed = await s.io.runAsync(command, []).result;

      expect(fed.stdout).toBe("hello");
      expect(unfed.stdout).toBe("");
    },
  },
  {
    member: "runAsync",
    title:
      "delivers each stdout line in order, empty and unterminated ones too",
    run: async (s) => {
      const lines: string[] = [];
      const result = await s.io.runAsync(
        s.program("lines", exit(0, "a\n\nb")),
        [],
        { onStdoutLine: (line) => void lines.push(line) },
      ).result;

      expect(lines).toEqual(["a", "", "b"]);
      expect(result.stdout).toBe("a\n\nb");
    },
  },
  {
    member: "runAsync",
    title: "an stderr line callback returning true drops that line from stderr",
    run: async (s) => {
      const seen: string[] = [];
      const result = await s.io.runAsync(
        s.program("noisy", exit(0, "", "keep\ndrop\n")),
        [],
        {
          onStderrLine: (line) => {
            seen.push(line);

            return line === "drop";
          },
        },
      ).result;

      expect(seen).toEqual(["keep", "drop"]);
      expect(result.stderr).toBe("keep\n");
    },
  },
  {
    member: "runAsync",
    title: "kill settles a plain program with status 128 and no flags",
    run: async (s) => {
      const running = s.io.runAsync(s.program("hold", { kind: "hold" }), []);

      await s.elapse(100);
      running.kill();

      const result = await running.result;

      expect(result.started).toBe(true);
      expect(result.status).toBe(128);
      expect(result.timedOut).toBeUndefined();
      expect(result.stopped).toBeUndefined();
    },
  },
  {
    member: "runAsync",
    title: "kill after the call settled does not throw and keeps the result",
    run: async (s) => {
      const running = s.io.runAsync(s.program("done", exit(3, "out")), []);
      const before = await running.result;

      expect(() => running.kill()).not.toThrow();
      expect(await running.result).toEqual(before);
    },
  },
  {
    member: "runAsync",
    title: "a program that ignores SIGTERM survives kill and ends on SIGKILL",
    run: async (s) => {
      const { running, tracked } = await startStubborn(s);

      running.kill();
      await s.elapse(300);

      expect(tracked.settled()).toBe(false);

      running.kill("SIGKILL");

      const result = await tracked.result;

      expect(result.started).toBe(true);
      expect(result.status).toBe(128);
    },
  },
  {
    member: "runAsync",
    title: "a timeout kills a program that outlives it with status 128",
    run: async (s) => {
      const running = s.io.runAsync(s.program("hold", { kind: "hold" }), [], {
        timeoutMs: 300,
      });
      const tracked = track(running);

      await s.elapse(400);
      await until(s, tracked.settled);

      const result = await tracked.result;

      expect(result.started).toBe(true);
      expect(result.timedOut).toBe(true);
      expect(result.status).toBe(128);
    },
  },
  {
    member: "runAsync",
    title:
      "a timeout with a grace period escalates to a kill that ends a SIGTERM-proof program",
    run: async (s) => {
      const running = s.io.runAsync(
        s.program("stubborn", { kind: "stubborn" }),
        [],
        { timeoutMs: 500, graceMs: 1000 },
      );
      const tracked = track(running);

      await s.elapse(600);
      await until(s, tracked.settled);

      const result = await tracked.result;

      expect(result.started).toBe(true);
      expect(result.timedOut).toBe(true);
      expect(result.status).toBe(128);
    },
  },
  {
    member: "launch",
    title: "starts the program with its arguments and returns at once",
    run: async (s) => {
      const file = `${s.directory}/launched`;
      const command = s.program("mark", { kind: "mark", file });

      expect(s.io.launch(command, ["x", "y"])).toEqual({
        started: true,
        message: "",
      });

      let content = "";

      for (let index = 0; index < 50 && content !== "x y"; index += 1) {
        await s.elapse(100);

        content = s.io.exists(file) ? s.io.readFile(file) : "";
      }

      expect(content).toBe("x y");
    },
  },
  {
    member: "launch",
    title: "a program that is not there still reports started",
    run: async (s) => {
      expect(s.io.launch(`${s.directory}/missing`, [])).toEqual({
        started: true,
        message: "",
      });
    },
  },
  {
    member: "request",
    title: "returns the reply to a line sent to a server",
    run: async (s) => {
      const socket = await s.serve("echo");

      await new Promise((resolve) => setImmediate(resolve));

      expect(s.io.request(socket, '{"a":1}')).toEqual({
        connected: true,
        response: 'got:{"a":1}',
        message: "",
      });
    },
  },
  {
    member: "request",
    title: "returns only the first line of a longer reply",
    run: async (s) => {
      const socket = await s.serve("multi");

      await new Promise((resolve) => setImmediate(resolve));

      expect(s.io.request(socket, "go")).toMatchObject({
        connected: true,
        response: "one",
      });
    },
  },
  {
    member: "request",
    title: "no server at the path is not connected and says why",
    run: async (s) => {
      const result = s.io.request(`${s.directory}/none.sock`, "go");

      expect(result.connected).toBe(false);
      expect(result.response).toBe("");
      expect(result.message).not.toBe("");
    },
  },
  {
    member: "request",
    title:
      "a server that closes without replying is not connected and says why",
    run: async (s) => {
      const socket = await s.serve("close");

      await new Promise((resolve) => setImmediate(resolve));

      const result = s.io.request(socket, "go");

      expect(result.connected).toBe(false);
      expect(result.response).toBe("");
      expect(result.message).not.toBe("");
    },
  },
  {
    member: "request",
    title: "an empty first line is not connected",
    run: async (s) => {
      const socket = await s.serve("empty");

      await new Promise((resolve) => setImmediate(resolve));

      expect(s.io.request(socket, "go")).toMatchObject({
        connected: false,
        response: "",
      });
    },
  },
  {
    member: "request",
    title: "a reply with no newline is not connected",
    run: async (s) => {
      const socket = await s.serve("unterminated");

      await new Promise((resolve) => setImmediate(resolve));

      expect(s.io.request(socket, "go")).toMatchObject({
        connected: false,
        response: "",
      });
    },
  },
];

export const PROCESS_MEMBERS_COVERED: ReadonlySet<string> = new Set(
  CASES.map((entry) => entry.member),
);

export function ioProcessesContract(
  title: string,
  subject: () => IoProcessesSubject,
): void {
  describe(title, () => {
    for (const entry of CASES) {
      it(`${entry.member}: ${entry.title}`, async () => {
        const s = subject();

        try {
          await entry.run(s);
        } finally {
          s.dispose();
        }
      });
    }
  });
}
