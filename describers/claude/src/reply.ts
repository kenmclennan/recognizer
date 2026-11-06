import { DescribeError } from "./describe.js";

export const LIMIT_STATUS = 75;

const LIMIT_TEXT =
  /usage limit|limit reached|hit your limit|rate limit|too many requests/i;

export class LimitError extends DescribeError {}

function jsonObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);

    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function interpretReply(
  status: number | null,
  signal: NodeJS.Signals | null,
  stdout: string,
  stderr: string,
): string {
  const object = jsonObject(stdout.trim());
  const detail = stderr.trim();

  if (object === null) {
    if (status !== 0) {
      if (LIMIT_TEXT.test(detail)) {
        throw new LimitError(detail);
      }

      throw new DescribeError(
        `claude exited with ${status ?? signal}${detail ? `: ${detail}` : ""}`,
      );
    }

    throw new DescribeError("claude did not return a JSON object");
  }

  const result = typeof object.result === "string" ? object.result : "";

  if (object.is_error === true) {
    if (object.api_error_status === 429 || LIMIT_TEXT.test(result)) {
      throw new LimitError(result);
    }

    throw new DescribeError(
      `claude exited with ${status ?? signal}${result ? `: ${result}` : ""}`,
    );
  }

  if (status !== 0) {
    throw new DescribeError(
      `claude exited with ${status ?? signal}${detail ? `: ${detail}` : ""}`,
    );
  }

  if (typeof object.result !== "string") {
    throw new DescribeError("claude returned no result");
  }

  return object.result;
}
