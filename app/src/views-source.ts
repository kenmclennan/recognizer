import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Scan } from "recognizer";
import type { ViewListing, ViewsPort } from "./views-port";

export const viewsSource: ViewsPort = {
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
  copy: (text) => navigator.clipboard.writeText(text),
  author: () => invoke<string>("view_author"),
  onChanged(run) {
    void invoke<void>("watch_views");

    const pending = listen("views-changed", () => run());

    return () => void pending.then((stop) => stop());
  },
};
