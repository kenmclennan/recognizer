import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type {
  BranchesReply,
  CommitsPort,
  HistoryReply,
  PullRequestsReply,
  RefFacts,
} from "./commits-port";

export const commitsSource: CommitsPort = {
  listHistory: () => invoke<HistoryReply>("list_history"),
  listBranches: () => invoke<BranchesReply>("list_branches"),
  refFacts: (refs) => invoke<RefFacts[]>("ref_facts", { refs }),
  listPullRequests: () => invoke<PullRequestsReply>("read_pull_requests"),
  onFocus(run) {
    const pending = getCurrentWebviewWindow().onFocusChanged((event) => {
      if (event.payload) {
        run();
      }
    });

    return () => void pending.then((stop) => stop());
  },
};
