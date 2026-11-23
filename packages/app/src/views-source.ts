import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { readRepositoryFiles } from "./scan-loading";
import type {
  ChangeRange,
  RangeMembers,
  ViewListing,
  ViewsPort,
} from "./views-port";

export const viewsSource: ViewsPort = {
  remove: (name) => invoke<void>("remove_view", { name }),
  changeRange: (base, head) =>
    invoke<ChangeRange | null>("change_range", { base, head }),
  recent: () => invoke<string[]>("read_recent_views"),
  recordOpened: (name) => invoke<void>("record_recent_view", { name }),
  list: () => invoke<ViewListing>("list_views"),
  write: (name, text) => invoke<void>("write_view", { name, text }),
  rename: (from, to) => invoke<void>("rename_view", { from, to }),
  link: (name) => invoke<string>("view_link", { name }),
  takePendingView: () => invoke<string | null>("take_pending_view"),
  renamesSince: (commit) =>
    invoke<{ from: string; to: string }[]>("renames_since", { commit }),
  async scansAt(commit) {
    const outcome = await invoke<
      { Ok: { file: string; text: string }[] } | { Err: string }
    >("scans_at", { commit });

    return "Err" in outcome
      ? { ok: false, reason: outcome.Err }
      : {
          ok: true,
          value: readRepositoryFiles(
            outcome.Ok.map(({ file, text }) => ({
              file,
              document: JSON.parse(text),
            })),
          ),
        };
  },
  async rangeMembers(base, head) {
    const outcome = await invoke<
      | {
          Ok: {
            base_scans: { file: string; text: string }[];
            head_scans: { file: string; text: string }[];
            files: RangeMembers["files"];
          };
        }
      | { Err: string }
    >("range_members", { base, head });

    if ("Err" in outcome) {
      return { ok: false, reason: outcome.Err };
    }

    const found = outcome.Ok;

    return {
      ok: true,
      value: {
        baseScans: readRepositoryFiles(
          found.base_scans.map(({ file, text }) => ({
            file,
            document: JSON.parse(text),
          })),
        ),
        headScans: readRepositoryFiles(
          found.head_scans.map(({ file, text }) => ({
            file,
            document: JSON.parse(text),
          })),
        ),
        files: found.files,
      },
    };
  },
  copy: (text) => navigator.clipboard.writeText(text),
  author: () => invoke<string>("view_author"),
  onChanged(run) {
    void invoke<void>("watch_views");

    const pending = listen("views-changed", () => run());

    return () => void pending.then((stop) => stop());
  },
};
