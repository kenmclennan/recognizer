import type {
  Assistant,
  AssistantAllow,
  AssistantAnswer,
  AssistantRequest,
  AssistantResult,
  RunningAsk,
} from "@recognizer/core";
import type { Io } from "../../cli.js";

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, "g");
const TARGET_KEYS = ["file_path", "path", "pattern", "command"];

export function allowRules(allow: AssistantAllow): string[] {
  return [
    ...allow.tools,
    ...allow.commands.map(({ command, anyArguments }) =>
      anyArguments ? `Bash(${command}:*)` : `Bash(${command})`,
    ),
  ];
}

export function claudeArgs(
  model: string,
  schema: string,
  allow: AssistantAllow,
): string[] {
  return [
    "-p",
    "--model",
    model,
    "--output-format",
    "stream-json",
    "--verbose",
    "--json-schema",
    schema,
    "--no-session-persistence",
    "--permission-mode",
    "dontAsk",
    "--allowedTools",
    ...allowRules(allow),
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    "--disable-slash-commands",
  ];
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function targetOf(input: unknown): string {
  const fields = record(input);

  for (const key of TARGET_KEYS) {
    const text = fields?.[key];

    if (typeof text === "string") {
      return text;
    }
  }

  return "";
}

export interface StreamFacts {
  progress: string[];
  answer: AssistantAnswer | null;
}

export function parseStreamLine(line: string): StreamFacts {
  let value: Record<string, unknown> | null;

  try {
    value = record(JSON.parse(line));
  } catch {
    return { progress: [], answer: null };
  }

  if (value?.type === "assistant") {
    const content = record(value.message)?.content;
    const progress = Array.isArray(content)
      ? content.flatMap((item) => {
          const part = record(item);

          if (part?.type !== "tool_use") {
            return [];
          }

          const name = typeof part.name === "string" ? part.name : "tool";
          const target = targetOf(part.input);

          return [target === "" ? name : `${name} ${target}`];
        })
      : [];

    return { progress, answer: null };
  }

  if (value?.type === "result") {
    const structured = value.structured_output;

    return {
      progress: [],
      answer: {
        structured: structured === undefined ? null : structured,
        costUsd:
          typeof value.total_cost_usd === "number"
            ? value.total_cost_usd
            : null,
        durationMs:
          typeof value.duration_ms === "number" ? value.duration_ms : null,
        isError: value.is_error === true,
        subtype: typeof value.subtype === "string" ? value.subtype : null,
        text: typeof value.result === "string" ? value.result : null,
        denials: Array.isArray(value.permission_denials)
          ? value.permission_denials.length
          : 0,
      },
    };
  }

  return { progress: [], answer: null };
}

export class AssistantAdapter implements Assistant {
  constructor(private readonly io: Io) {}

  ask(request: AssistantRequest): RunningAsk {
    let answer: AssistantAnswer | null = null;

    const running = this.io.runAsync(
      "claude",
      claudeArgs(request.model, request.schema, request.allow),
      {
        cwd: request.root,
        input: request.prompt,
        ...(request.environment === undefined
          ? {}
          : { env: { ...request.environment } }),
        onStdoutLine: (line) => {
          const facts = parseStreamLine(line);

          for (const entry of facts.progress) {
            request.onLine(entry);
          }

          if (facts.answer !== null) {
            answer = facts.answer;
          }
        },
      },
    );

    return {
      kill: () => running.kill(),
      result: running.result.then(
        (run): AssistantResult => ({
          answer,
          exit: run.status,
          stderr: run.started
            ? run.stderr.replace(ANSI, "")
            : `claude could not start: ${run.stderr}`,
          started: run.started,
        }),
      ),
    };
  }
}
