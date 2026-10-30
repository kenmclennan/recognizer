export interface DescribeRequest {
  module: string;
  kind: string;
  source: string;
  members: unknown[];
  uses: unknown[];
  used_by: unknown[];
}

export type RunClaude = (input: string) => string;

export class DescribeError extends Error {}

export class UsageError extends Error {}

export function parseRequest(text: string): DescribeRequest {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new UsageError(
      `request is not valid JSON: ${(error as Error).message}`,
    );
  }

  const request = value as Record<string, unknown> | null;

  if (
    typeof request !== "object" ||
    request === null ||
    typeof request.module !== "string" ||
    typeof request.source !== "string" ||
    !Array.isArray(request.members) ||
    !Array.isArray(request.uses) ||
    !Array.isArray(request.used_by)
  ) {
    throw new UsageError(
      "request needs a string module and source and arrays members, uses and used_by",
    );
  }

  return {
    module: request.module,
    kind: typeof request.kind === "string" ? request.kind : "module",
    source: request.source,
    members: request.members,
    uses: request.uses,
    used_by: request.used_by,
  };
}

export function buildInput(request: DescribeRequest, prompt: string): string {
  const outline = JSON.stringify(
    { members: request.members, uses: request.uses, used_by: request.used_by },
    null,
    2,
  );

  return [
    prompt,
    "",
    `Module: ${request.module}`,
    `Kind: ${request.kind}`,
    "",
    "Outline (JSON):",
    outline,
    "",
    "Source:",
    request.source,
  ].join("\n");
}

export function describeModule(
  request: DescribeRequest,
  prompt: string,
  runClaude: RunClaude,
): string {
  const line = runClaude(buildInput(request, prompt)).trim();

  if (line === "") {
    throw new DescribeError("claude returned an empty reply");
  }

  const count = line.split(/\r?\n/).length;

  if (count > 1) {
    throw new DescribeError(`claude returned ${count} lines, expected one`);
  }

  return line;
}
