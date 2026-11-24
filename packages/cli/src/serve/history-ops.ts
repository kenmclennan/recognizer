import { availableParallelism } from "node:os";
import { resolve } from "node:path";
import {
  adoptScanBaseline,
  beginGitWatch,
  clearScanOrigin,
  endGitWatch,
  Limiter,
  listBranches,
  listHistory,
  listPullRequests,
  pollGitWatch,
  pollScanChanges,
  readChangeDetail,
  readRefFacts,
  readWorkingTree,
  type ScanBaselinePorts,
  takeScanOrigin,
  WindowBaselines,
} from "@recognizer/core";
import { RecordedScansAdapter } from "../adapters/filesystem/recorded-scans-adapter.js";
import { WorkTreeAdapter } from "../adapters/filesystem/work-tree-adapter.js";
import { ForgeAdapter } from "../adapters/git/forge-adapter.js";
import { GitAdapter } from "../adapters/git/git-adapter.js";
import type { Io } from "../cli.js";
import { text, textList } from "./wire.js";

const MAX_HISTORY_READS = 4;

export const HISTORY_OPS: ReadonlySet<string> = new Set([
  "history.list",
  "history.branches",
  "history.facts",
  "history.detail",
  "history.pulls",
  "changes.take",
  "changes.clear",
  "changes.adopt",
  "changes.poll",
  "git.begin",
  "git.poll",
  "git.end",
  "changes.worktree",
]);

export class HistoryOps {
  private readonly ports: ScanBaselinePorts & { forge: ForgeAdapter };
  private readonly windows = new WindowBaselines();

  constructor(io: Io) {
    this.ports = {
      git: new GitAdapter(io),
      forge: new ForgeAdapter(io),
      recordedScans: new RecordedScansAdapter(),
      workTree: new WorkTreeAdapter(),
      limiter: new Limiter(
        Math.max(1, Math.min(MAX_HISTORY_READS, availableParallelism())),
      ),
    };
  }

  private root(args: Record<string, unknown>): string {
    return resolve(text(args, "repository"));
  }

  async run(op: string, args: Record<string, unknown>): Promise<unknown> {
    switch (op) {
      case "history.list":
        return listHistory(this.ports, this.root(args));
      case "history.branches":
        return listBranches(this.ports, this.root(args));
      case "history.facts":
        return readRefFacts(
          this.ports,
          this.root(args),
          textList(args, "refs") ?? [],
        );
      case "history.detail":
        return readChangeDetail(
          this.ports,
          this.root(args),
          text(args, "kind"),
          typeof args.reference === "string" ? args.reference : "",
        );
      case "history.pulls":
        return listPullRequests(this.ports, this.root(args));
      case "changes.take":
        return takeScanOrigin(
          this.ports,
          this.windows,
          text(args, "window"),
          this.root(args),
        );
      case "changes.clear":
        return clearScanOrigin(
          this.windows,
          text(args, "window"),
          args.closed === true,
        );
      case "changes.adopt":
        return adoptScanBaseline(
          this.ports,
          this.windows,
          text(args, "window"),
          this.root(args),
        );
      case "changes.poll":
        return pollScanChanges(
          this.ports,
          this.windows,
          text(args, "window"),
          this.root(args),
        );
      case "git.begin":
        return beginGitWatch(
          this.ports,
          this.windows,
          text(args, "window"),
          this.root(args),
        );
      case "git.poll":
        return pollGitWatch(
          this.ports,
          this.windows,
          text(args, "window"),
          this.root(args),
        );
      case "changes.worktree":
        return readWorkingTree(this.ports, this.root(args));
      case "git.end":
        endGitWatch(this.windows, text(args, "window"));

        return null;
      default:
        throw new Error(`unknown history operation ${op}`);
    }
  }
}
