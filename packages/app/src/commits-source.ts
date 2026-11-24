import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type {
  BranchesReply,
  ChangeDetailReply,
  CommitsPort,
  HistoryReply,
  PullRequestsReply,
  RefFacts,
} from "./commits-port";
import { coreReply } from "./scan-source";

type Invoke = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

type Listen = (
  event: string,
  handler: () => void,
) => Promise<() => void> | Promise<unknown>;

export function createCommitsSource(
  call: Invoke = invoke as Invoke,
  on: Listen = listen as Listen,
): CommitsPort {
  const ask = async <T>(op: string, args: Record<string, unknown> = {}) =>
    coreReply<T>(await call("core_call", { op, args }));

  return {
    listHistory: () => ask<HistoryReply>("history.list"),
    listBranches: () => ask<BranchesReply>("history.branches"),
    refFacts: (refs) => ask<RefFacts[]>("history.facts", { refs }),
    listPullRequests: () => ask<PullRequestsReply>("history.pulls"),
    changeDetail: (kind, reference) =>
      ask<ChangeDetailReply>("history.detail", { kind, reference }),
    watchGit(onChange) {
      const pending = on("git-changed", () => onChange());

      void pending.then(() => call<void>("watch_git"));

      return () => {
        void pending.then((stop) => (stop as () => void)());
        void call<void>("unwatch_git");
      };
    },
    onFocus(run) {
      const pending = getCurrentWebviewWindow().onFocusChanged((event) => {
        if (event.payload) {
          run();
        }
      });

      return () => void pending.then((stop) => stop());
    },
  };
}

export const commitsSource: CommitsPort = createCommitsSource();
