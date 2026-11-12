import type { Io } from "./cli.js";
import validate from "./generated/scan-answer-validator.js";
import { answerPath, type HeldMarker } from "./scan-marker.js";

export const ANSWER_POLL_MS = 250;

export interface DescribeAnswer {
  version: 1;
  run_id: string;
  describe: boolean;
}

export function parseAnswer(text: string): DescribeAnswer | null {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }

  return validate(value) ? (value as unknown as DescribeAnswer) : null;
}

function takeAnswer(io: Io, path: string, runId: string): boolean | null {
  if (!io.exists(path)) {
    return null;
  }

  let text: string;

  try {
    text = io.readFile(path);
  } catch {
    return null;
  }

  io.remove(path);

  const answer = parseAnswer(text);

  return answer !== null && answer.run_id === runId ? answer.describe : null;
}

export async function awaitDescribeAnswer(
  io: Io,
  root: string,
  held: HeldMarker,
): Promise<boolean> {
  const path = answerPath(root);
  const controller = new AbortController();
  let typed: boolean | null = null;
  let hearing: Promise<void> | null = null;

  if (held.origin === "cli") {
    hearing = io.readLine(controller.signal).then((line) => {
      if (!controller.signal.aborted) {
        typed = line?.trim() === "describe";
      }
    });
  }

  try {
    for (;;) {
      const filed = takeAnswer(io, path, held.runId);

      if (filed !== null) {
        return filed;
      }

      if (typed !== null) {
        return typed;
      }

      await Promise.race(
        hearing === null
          ? [io.wait(ANSWER_POLL_MS)]
          : [io.wait(ANSWER_POLL_MS), hearing],
      );
    }
  } finally {
    controller.abort();
  }
}
