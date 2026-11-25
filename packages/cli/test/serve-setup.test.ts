import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../tools/scripts/pool-scale.mjs";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { isolatedPath } from "./isolated-path.js";
import { launcher, Serve } from "./serve-harness.js";
import { writeStubSurveyPlugin } from "./stub-survey-plugin.js";

const TIMEOUT = scaledTimeout(60_000);

const RESULT =
  '{"type":"result","subtype":"success","is_error":false,"duration_ms":5,"total_cost_usd":0.1,"structured_output":{"entries":[]}}';

function repository(): string {
  const directory = makeTempDir("serve-setup-repo-");

  execFileSync("git", ["init", "-q", directory]);
  writeFileSync(join(directory, "a.txt"), "a\n");

  return directory;
}

function pluginDirectory(holdSeconds?: number): string {
  const directory = makeTempDir("serve-setup-plugins-");

  writeStubSurveyPlugin(directory, {
    name: "typescript",
    order: 1,
    extensions: [".ts"],
    ...(holdSeconds === undefined ? {} : { holdSeconds }),
  });

  return directory;
}

function claudeDirectory(body: string): string {
  const directory = makeTempDir("serve-setup-claude-");

  launcher(directory, "claude", body);

  return directory;
}

function pathWith(...directories: string[]): Record<string, string> {
  return {
    PATH: isolatedPath(...directories),
  };
}

function streamOf(serve: Serve, id: string) {
  return serve.lines.filter((line) => line.stream === id);
}

describe("serve setup", () => {
  it(
    "a survey replies with the setup id, streams the step lines in order, then one outcome",
    async () => {
      const serve = new Serve(pluginDirectory());

      try {
        const reply = await serve.call("setup.start", {
          repository: repository(),
          action: "survey",
          extract: false,
          environment: {},
        });
        const id = reply.ok as string;

        expect(typeof id).toBe("string");

        const outcome = await serve.until(() =>
          serve.lines.find((line) => line.stream === id && line.outcome),
        );
        const steps = streamOf(serve, id)
          .filter((line) => line.event !== undefined)
          .map((line) => JSON.parse(line.event as string))
          .map((event) => `${event.step}:${event.state}`);

        expect(steps).toEqual([
          "survey:run",
          "survey:done",
          "reading:run",
          "reading:done",
        ]);
        expect(outcome.outcome.status).toBe("ok");
        expect(outcome.outcome.survey.survey_version).toBe(1);
        expect(streamOf(serve, id).filter((line) => line.outcome)).toHaveLength(
          1,
        );
        expect(serve.lines.at(-1)?.outcome).toBeDefined();
      } finally {
        await serve.close();
      }
    },
    TIMEOUT,
  );

  it(
    "a second request is answered while a survey runs",
    async () => {
      const serve = new Serve(pluginDirectory(4));

      try {
        const reply = await serve.call("setup.start", {
          repository: repository(),
          action: "survey",
          extract: false,
          environment: {},
        });
        const id = reply.ok as string;
        const status = await serve.call("scan.status", {
          repository: repository(),
        });

        expect(status.ok).toEqual({ running: false });
        expect(
          serve.lines.some((line) => line.stream === id && line.outcome),
        ).toBe(false);

        await serve.until(() =>
          serve.lines.find((line) => line.stream === id && line.outcome),
        );
      } finally {
        await serve.close();
      }
    },
    TIMEOUT,
  );

  it(
    "a use case that fails to start leaves the service answering",
    async () => {
      const serve = new Serve(pluginDirectory());

      try {
        const bad = await serve.call("setup.start", {
          repository: repository(),
          action: "apply",
          environment: {},
        });

        const failed = await serve.until(() =>
          serve.lines.find((line) => line.stream === bad.ok && line.outcome),
        );

        expect(failed.outcome.status).toBe("failed");

        const unknown = await serve.call("setup.start", {
          repository: repository(),
          action: "nothing",
        });

        expect(typeof unknown.error).toBe("string");

        const next = await serve.call("scan.status", {
          repository: repository(),
        });

        expect(next.ok).toEqual({ running: false });
      } finally {
        await serve.close();
      }
    },
    TIMEOUT,
  );

  it(
    "a recommend runs the claude the request's environment names, in the service's process group",
    async () => {
      const scratch = makeTempDir("serve-setup-group-");
      const group = join(scratch, "group");
      const claude = claudeDirectory(
        `cat > /dev/null\nps -o pgid= -p $$ > '${group}'\necho '${RESULT}'`,
      );
      const serve = new Serve(pluginDirectory());

      try {
        const reply = await serve.call("setup.start", {
          repository: repository(),
          action: "recommend",
          model: "sonnet",
          prompt: "p",
          schema: { type: "object" },
          environment: pathWith(claude),
        });
        const id = reply.ok as string;
        const outcome = await serve.until(() =>
          serve.lines.find((line) => line.stream === id && line.outcome),
        );

        expect(outcome.outcome).toMatchObject({ status: "proposal" });

        const servicePgid = execFileSync("ps", [
          "-o",
          "pgid=",
          "-p",
          String(serve.child.pid),
        ])
          .toString()
          .trim();

        expect(readFileSync(group, "utf8").trim()).toBe(servicePgid);
      } finally {
        await serve.close();
      }
    },
    TIMEOUT,
  );

  it(
    "a setup request's pairs get the folder",
    async () => {
      const claude = claudeDirectory(`cat > /dev/null\necho '${RESULT}'`);
      const serve = new Serve(pluginDirectory(), {
        RECOGNIZER_TOOLCHAIN_COMMANDS: claude,
      });

      try {
        const reply = await serve.call("setup.start", {
          repository: repository(),
          action: "recommend",
          model: "sonnet",
          prompt: "p",
          schema: { type: "object" },
          environment: pathWith(),
        });
        const id = reply.ok as string;
        const outcome = await serve.until(() =>
          serve.lines.find((line) => line.stream === id && line.outcome),
        );

        expect(outcome.outcome).toMatchObject({ status: "proposal" });
      } finally {
        await serve.close();
      }
    },
    TIMEOUT,
  );

  it(
    "a stop request cancels a running recommend",
    async () => {
      const scratch = makeTempDir("serve-setup-stop-");
      const started = join(scratch, "started");
      const claude = claudeDirectory(
        `cat > /dev/null\ntouch '${started}'\nexec sleep 30`,
      );
      const serve = new Serve(pluginDirectory());

      try {
        const reply = await serve.call("setup.start", {
          repository: repository(),
          action: "recommend",
          model: "sonnet",
          prompt: "p",
          schema: "{}",
          environment: pathWith(claude),
        });
        const id = reply.ok as string;

        await serve.until(() =>
          readFileSyncOrUndefined(started) === undefined ? undefined : true,
        );

        const stopped = await serve.call("setup.stop", { setup: id });

        expect(stopped.ok).toBeNull();

        const outcome = await serve.until(() =>
          serve.lines.find((line) => line.stream === id && line.outcome),
        );

        expect(outcome.outcome).toEqual({ status: "cancelled" });

        const missing = await serve.call("setup.stop", { setup: id });

        expect(typeof missing.error).toBe("string");
      } finally {
        await serve.close();
      }
    },
    TIMEOUT,
  );

  it(
    "an apply and a try with nothing to change finish",
    async () => {
      const serve = new Serve(pluginDirectory());

      try {
        for (const action of ["apply", "try"]) {
          const target = repository();

          mkdirSync(join(target, ".recognizer"), { recursive: true });

          const reply = await serve.call("setup.start", {
            repository: target,
            action,
            choices: {},
            environment: {},
          });
          const id = reply.ok as string;
          const outcome = await serve.until(() =>
            serve.lines.find((line) => line.stream === id && line.outcome),
          );

          expect(outcome.outcome.status).toBe("finished");
          expect(outcome.outcome.result.event).toBe("result");
        }
      } finally {
        await serve.close();
      }
    },
    TIMEOUT,
  );
});

function readFileSyncOrUndefined(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}
