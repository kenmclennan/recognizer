import type { HistoryPorts } from "./history-ports.js";
import { type PullRequestsReply, runGh } from "./list-pull-requests.js";

const CHANGE_PULL_FIELDS =
  "number,title,body,state,isDraft,author,statusCheckRollup";
const BRANCH_PULL_FIELDS = "number,title,isDraft,author,statusCheckRollup";

export interface ChangeDetailReply {
  readonly git: string | null;
  readonly pull: PullRequestsReply | null;
  readonly defaultRef: string | null;
}

export async function readChangeDetail(
  ports: HistoryPorts,
  root: string,
  kind: string,
  reference: string,
): Promise<ChangeDetailReply> {
  const { git, limiter } = ports;

  if (kind === "commit" || kind === "branch") {
    const resolved = await limiter.run(async () =>
      git.resolveRef(root, reference),
    );

    if (resolved === null) {
      throw new Error(`not a ${kind}: ${reference}`);
    }

    if (kind === "commit") {
      return {
        git: await limiter.run(() => git.commitDetail(root, reference)),
        pull: null,
        defaultRef: null,
      };
    }

    const tip = await limiter.run(() => git.tipSummary(root, reference));
    const pull = await runGh(
      ports,
      root,
      [
        "pr",
        "list",
        "--state",
        "open",
        "--head",
        reference,
        "--limit",
        "1",
        "--json",
        BRANCH_PULL_FIELDS,
      ],
      "gh pr list failed",
    );

    return { git: tip, pull, defaultRef: git.defaultRef(root) };
  }

  if (kind === "pr") {
    if (
      reference === "" ||
      reference.length > 9 ||
      !/^[0-9]+$/.test(reference)
    ) {
      throw new Error(`not a pull request number: ${reference}`);
    }

    const pull = await runGh(
      ports,
      root,
      ["pr", "view", reference, "--json", CHANGE_PULL_FIELDS],
      "gh pr view failed",
    );

    return { git: null, pull, defaultRef: git.defaultRef(root) };
  }

  throw new Error(`unknown change kind: ${kind}`);
}
