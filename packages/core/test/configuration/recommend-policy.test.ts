import { describe, expect, it } from "vitest";
import {
  type AssistantResult,
  outcomeOf,
  recommendPolicy,
} from "../../src/index.js";
import { PROPOSAL } from "../fakes/fake-assistant.js";
import { ManualStop } from "./setup-run-world.js";
import { ROOT, worldOf } from "./world.js";

const ask = {
  root: ROOT,
  model: "sonnet",
  prompt: "p",
  schema: "{}",
  onLine: () => {},
};

function result(facts: Partial<AssistantResult>): AssistantResult {
  return { answer: null, exit: 0, stderr: "", started: true, ...facts };
}

function answer(over: Partial<NonNullable<AssistantResult["answer"]>>) {
  return { ...PROPOSAL, ...over };
}

describe("recommendPolicy", () => {
  it("a result is a proposal, a failure or a signal exit", () => {
    expect(
      outcomeOf(
        result({
          answer: answer({
            structured: { changes: [] },
            costUsd: 1,
            durationMs: 9,
          }),
        }),
      ),
    ).toMatchObject({ status: "proposal", costUsd: 1, durationMs: 9 });

    expect(
      outcomeOf(
        result({
          answer: answer({ structured: null, subtype: "success" }),
        }),
      ).status,
    ).toBe("failed");

    const limited = outcomeOf(
      result({ exit: 1, stderr: "Claude usage limit reached" }),
    );

    expect(limited.status).toBe("failed");
    expect(limited.status === "failed" && limited.reason).toContain("limit");

    const signalled = outcomeOf(result({ exit: null, stderr: "killed" }));

    expect(signalled.status === "failed" && signalled.reason).toBe(
      "claude exited by signal without an answer: killed",
    );
  });

  it("a signed out assistant gets the app's own reason and a limit keeps its own", () => {
    const signedOut = outcomeOf(
      result({
        exit: 1,
        answer: answer({
          structured: null,
          isError: true,
          text: "Not logged in · Please run /login",
          costUsd: 0,
          durationMs: 53,
        }),
      }),
    );

    expect(signedOut).toMatchObject({
      status: "failed",
      reason:
        "Claude Code is not signed in. Open a terminal, run claude and sign in, then try again.",
    });

    const limited = outcomeOf(
      result({
        exit: 1,
        answer: answer({
          structured: null,
          isError: true,
          text: "Claude usage limit reached",
        }),
      }),
    );

    expect(limited).toMatchObject({
      status: "failed",
      reason: "Claude usage limit reached",
    });
  });

  it("keeps the last 2000 characters of stderr", () => {
    const outcome = outcomeOf(
      result({ exit: 2, stderr: `${"a".repeat(2500)}END` }),
    );

    expect(outcome.status === "failed" && outcome.reason).toBe(
      `claude exited 2 without an answer: ${"a".repeat(1997)}END`,
    );
  });

  it("asks the assistant with the read-only allow list and runs recommend over the proposal", async () => {
    const world = worldOf();

    world.fakes.assistant.lines = ["Read a.ts"];
    world.fakes.assistant.next = result({
      answer: answer({
        structured: {
          entries: [
            { kind: "ignore", globs: ["scripts/*"], why: "w", based_on: "b" },
          ],
        },
      }),
    });

    const lines: string[] = [];
    const outcome = await recommendPolicy(world.ports, {
      ...ask,
      onLine: (line) => lines.push(line),
      environment: { PATH: "/x" },
    });

    expect(lines).toEqual(["Read a.ts"]);
    expect(world.fakes.assistant.asked[0]).toMatchObject({
      root: ROOT,
      model: "sonnet",
      environment: { PATH: "/x" },
      allow: {
        tools: ["Read", "Glob", "Grep"],
        commands: [
          { command: "recognizer help", anyArguments: true },
          { command: "recognizer plugins", anyArguments: true },
          { command: "recognizer doctor", anyArguments: true },
          { command: "recognizer scan --extract", anyArguments: false },
          { command: "recognizer uses", anyArguments: true },
          { command: "recognizer used-by", anyArguments: true },
        ],
      },
    });
    expect(outcome).toMatchObject({
      status: "proposal",
      output: {
        entries: [{ kind: "ignore", globs: ["scripts/*"] }],
        dropped: [],
      },
    });
  });

  it("fails with the reason when the proposal has the wrong shape", async () => {
    const world = worldOf();

    world.fakes.assistant.next = result({
      answer: answer({ structured: { entries: [{ kind: "x" }] } }),
    });

    expect(await recommendPolicy(world.ports, ask)).toMatchObject({
      status: "failed",
      reason: "entry 1 has the wrong shape",
      costUsd: 0.25,
    });
  });

  it("is refused while a scan holds the repository", async () => {
    const world = worldOf();

    world.fakes.lock.acquire(ROOT, { sensors: [], describe: false });

    expect(await recommendPolicy(world.ports, ask)).toEqual({
      status: "refused",
      reason: "a scan is already running",
    });
    expect(world.fakes.assistant.asked).toEqual([]);
  });

  it("is unavailable when the assistant does not start", async () => {
    const world = worldOf();

    world.fakes.assistant.next = result({
      started: false,
      stderr: "claude could not start: not found",
    });

    expect(await recommendPolicy(world.ports, ask)).toEqual({
      status: "unavailable",
      reason: "claude could not start: not found",
    });
  });

  it("a stop kills the assistant and the outcome is cancelled", async () => {
    const world = worldOf();
    const stop = new ManualStop();

    world.fakes.assistant.hold = true;

    const asking = recommendPolicy(world.ports, { ...ask, stop });

    stop.request();

    expect(await asking).toEqual({ status: "cancelled" });
    expect(world.fakes.assistant.killed).toBe(1);
  });
});
