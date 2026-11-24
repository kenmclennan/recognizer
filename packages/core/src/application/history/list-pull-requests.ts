import type { HistoryPorts } from "./history-ports.js";
import type { ForgeResult } from "./ports/forge.js";

export const PULL_REQUEST_LIMIT = "50";
export const GH_TIMEOUT_MS = 20_000;

const PULL_REQUEST_FIELDS =
  "number,title,headRefName,headRefOid,author,updatedAt,isDraft,statusCheckRollup";

export type GhStatus = "ok" | "missing" | "signed-out" | "failed";

export interface PullRequestsReply {
  readonly status: GhStatus;
  readonly detail: string;
  readonly text: string;
}

function firstLine(text: string): string {
  return (text.split("\n")[0] ?? "").trim();
}

export function classifyForge(
  result: ForgeResult,
  failure: string,
): PullRequestsReply {
  if (!result.started) {
    return { status: "missing", detail: "", text: "" };
  }

  if (result.timedOut === true) {
    return {
      status: "failed",
      detail: "gh did not answer within 20 seconds",
      text: "",
    };
  }

  if (result.status === 0) {
    return { status: "ok", detail: "", text: result.stdout };
  }

  if (result.status === 4 && result.stderr.includes("gh auth login")) {
    return {
      status: "signed-out",
      detail: firstLine(result.stderr),
      text: "",
    };
  }

  return {
    status: "failed",
    detail: firstLine(result.stderr) || failure,
    text: "",
  };
}

export async function runGh(
  ports: HistoryPorts,
  root: string,
  args: readonly string[],
  failure: string,
): Promise<PullRequestsReply> {
  const result = await ports.limiter.run(() =>
    ports.forge.run(root, args, GH_TIMEOUT_MS),
  );

  return classifyForge(result, failure);
}

export function listPullRequests(
  ports: HistoryPorts,
  root: string,
): Promise<PullRequestsReply> {
  return runGh(
    ports,
    root,
    [
      "pr",
      "list",
      "--state",
      "open",
      "--limit",
      PULL_REQUEST_LIMIT,
      "--json",
      PULL_REQUEST_FIELDS,
    ],
    "gh pr list failed",
  );
}
