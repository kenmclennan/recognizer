import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Scan } from "recognizer";
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
    const files = await invoke<{ file: string; text: string }[] | null>(
      "scans_at",
      { commit },
    );

    return files === null
      ? null
      : files.map(({ text }) => JSON.parse(text) as Scan);
  },
  async rangeMembers(base, head) {
    const found = await invoke<{
      base_scans: { file: string; text: string }[];
      head_scans: { file: string; text: string }[];
      files: RangeMembers["files"];
    } | null>("range_members", { base, head });

    return found === null
      ? null
      : {
          baseScans: found.base_scans.map(
            ({ text }) => JSON.parse(text) as Scan,
          ),
          headScans: found.head_scans.map(
            ({ text }) => JSON.parse(text) as Scan,
          ),
          files: found.files,
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
