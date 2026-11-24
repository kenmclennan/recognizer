import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { readRepositoryFiles } from "./scan-loading";
import { coreReply } from "./scan-source";
import type { ChangeRange, ViewListing, ViewsPort } from "./views-port";

type Invoke = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

type ScanTexts = { file: string; text: string }[];

type Failed = { ok: false; reason: string };

type ScansReply = { ok: true; scans: ScanTexts } | Failed;

type MembersReply =
  | {
      ok: true;
      baseScans: ScanTexts;
      headScans: ScanTexts;
      files: {
        path: string;
        basePath: string;
        baseText: string | null;
        headText: string | null;
      }[];
    }
  | Failed;

function repositoryOf(scans: ScanTexts) {
  return readRepositoryFiles(
    scans.map(({ file, text }) => ({ file, document: JSON.parse(text) })),
  );
}

export function createViewsSource(call: Invoke = invoke as Invoke): ViewsPort {
  const ask = async <T>(op: string, args: Record<string, unknown> = {}) =>
    coreReply<T>(await call("core_call", { op, args }));

  return {
    remove: (name) => call<void>("remove_view", { name }),
    changeRange: (base, head) =>
      ask<ChangeRange | null>("view.range", { base, head }),
    recent: () => call<string[]>("read_recent_views"),
    recordOpened: (name) => call<void>("record_recent_view", { name }),
    list: () => call<ViewListing>("list_views"),
    write: (name, text) => call<void>("write_view", { name, text }),
    rename: (from, to) => call<void>("rename_view", { from, to }),
    link: (name) => call<string>("view_link", { name }),
    takePendingView: () => call<string | null>("take_pending_view"),
    renamesSince: (commit) =>
      ask<{ from: string; to: string }[]>("view.renames", { commit }),
    async scansAt(commit) {
      const reply = await ask<ScansReply>("view.scans", { commit });

      return reply.ok
        ? { ok: true, value: repositoryOf(reply.scans) }
        : { ok: false, reason: reply.reason };
    },
    async rangeMembers(base, head) {
      const reply = await ask<MembersReply>("view.members", { base, head });

      return reply.ok
        ? {
            ok: true,
            value: {
              baseScans: repositoryOf(reply.baseScans),
              headScans: repositoryOf(reply.headScans),
              files: reply.files.map((file) => ({
                path: file.path,
                base_path: file.basePath,
                base_text: file.baseText,
                head_text: file.headText,
              })),
            },
          }
        : { ok: false, reason: reply.reason };
    },
    copy: (text) => navigator.clipboard.writeText(text),
    author: () => ask<string>("view.author"),
    onChanged(run) {
      void call<void>("watch_views");

      const pending = listen("views-changed", () => run());

      return () => void pending.then((stop) => stop());
    },
  };
}

export const viewsSource: ViewsPort = createViewsSource();
