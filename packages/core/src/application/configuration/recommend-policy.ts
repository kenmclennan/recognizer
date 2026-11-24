import { Repository } from "../../domain/repository.js";
import type { ConfigurationPorts } from "./internal/configuration-ports.js";
import { recommendCards } from "./internal/recommend-cards.js";
import type { AssistantAllow, AssistantResult } from "./ports/assistant.js";
import { NO_STOP, type SetupStop } from "./setup-stop.js";

const STDERR_CHARS = 2000;
const LIMIT_TEXT = "usage limit";
const RATE_LIMIT_TEXT = "rate limit";
const SIGNED_OUT_TEXT = "not logged in";
const SIGNED_OUT_REASON =
  "Claude Code is not signed in. Open a terminal, run claude and sign in, then try again.";

export const ASSISTANT_ALLOW: AssistantAllow = {
  tools: ["Read", "Glob", "Grep"],
  commands: [
    { command: "recognizer help", anyArguments: true },
    { command: "recognizer plugins", anyArguments: true },
    { command: "recognizer doctor", anyArguments: true },
    { command: "recognizer scan --extract", anyArguments: false },
    { command: "recognizer uses", anyArguments: true },
    { command: "recognizer used-by", anyArguments: true },
  ],
};

export type RecommendOutcome =
  | {
      status: "proposal";
      output: unknown;
      costUsd: number | null;
      durationMs: number | null;
      denials: number;
    }
  | {
      status: "failed";
      reason: string;
      subtype: string | null;
      costUsd: number | null;
      durationMs: number | null;
    }
  | { status: "cancelled" }
  | { status: "refused"; reason: string }
  | { status: "unavailable"; reason: string };

export interface RecommendPolicyInput {
  root: string;
  model: string;
  prompt: string;
  schema: string;
  onLine: (line: string) => void;
  environment?: Readonly<Record<string, string>>;
  stop?: SetupStop;
}

function tail(text: string): string {
  return Array.from(text).slice(-STDERR_CHARS).join("");
}

export function outcomeOf(result: AssistantResult): RecommendOutcome {
  const facts = result.answer;

  if (facts !== null) {
    if (facts.structured !== null && !facts.isError) {
      return {
        status: "proposal",
        output: facts.structured,
        costUsd: facts.costUsd,
        durationMs: facts.durationMs,
        denials: facts.denials,
      };
    }

    const text =
      facts.text !== null && facts.text.trim() !== "" ? facts.text : null;

    return {
      status: "failed",
      reason:
        text === null
          ? "claude answered without a proposal"
          : text.toLowerCase().includes(SIGNED_OUT_TEXT)
            ? SIGNED_OUT_REASON
            : text,
      subtype: facts.subtype,
      costUsd: facts.costUsd,
      durationMs: facts.durationMs,
    };
  }

  const detail = result.stderr;
  const lower = detail.toLowerCase();
  const limited = lower.includes(LIMIT_TEXT) || lower.includes(RATE_LIMIT_TEXT);

  return {
    status: "failed",
    reason: limited
      ? `claude hit a usage or rate limit: ${tail(detail)}`
      : `claude exited ${result.exit === null ? "by signal" : result.exit} without an answer: ${tail(detail)}`,
    subtype: null,
    costUsd: null,
    durationMs: null,
  };
}

export async function recommendPolicy(
  ports: ConfigurationPorts,
  input: RecommendPolicyInput,
): Promise<RecommendOutcome> {
  const stop = input.stop ?? NO_STOP;
  const status = ports.lock.status(input.root);

  if (status.running) {
    return {
      status: "refused",
      reason: status.refusal ?? "a scan is already running",
    };
  }

  const running = ports.assistant.ask({
    root: input.root,
    model: input.model,
    prompt: input.prompt,
    schema: input.schema,
    allow: ASSISTANT_ALLOW,
    ...(input.environment === undefined
      ? {}
      : { environment: input.environment }),
    onLine: input.onLine,
  });

  stop.onRequest(() => running.kill());

  const result = await running.result;

  if (!result.started) {
    return {
      status: "unavailable",
      reason:
        result.stderr.trim() === ""
          ? "claude could not start"
          : result.stderr.trim(),
    };
  }

  if (stop.requested()) {
    return { status: "cancelled" };
  }

  const outcome = outcomeOf(result);

  if (outcome.status !== "proposal") {
    return outcome;
  }

  try {
    return {
      ...outcome,
      output: recommendCards(
        ports.policy,
        input.root,
        outcome.output,
        ports.reads.cachedScans(input.root) ?? Repository.empty,
      ),
    };
  } catch (error) {
    const reason =
      (error as { messages?: string[] }).messages?.join("; ") ??
      (error as Error).message;

    return {
      status: "failed",
      reason: tail(reason),
      subtype: null,
      costUsd: outcome.costUsd,
      durationMs: outcome.durationMs,
    };
  }
}
