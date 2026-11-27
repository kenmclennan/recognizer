import {
  afterTickChanges,
  type EstimateRequest,
  estimateFrom,
  type ScanHistory,
} from "@recognizer/core";
import {
  parseViewFile,
  serialiseView,
} from "../../cli/src/adapters/filesystem/view-translator";
import type { Answer } from "./look-draw";
import { commandKey, type Recording } from "./look-recording";

export type PageAnswers = {
  views?: { name: string; text: string }[];
};

export function pageAnswers(
  recording: Recording,
  given: PageAnswers = {},
): Answer {
  const started = [...recording.commands]
    .reverse()
    .find(
      ({ command, args }) =>
        command === "core_call" && args.op === "scan.start",
    );
  const recorded = new Set(
    recording.commands.map(({ command, args }) => commandKey(command, args)),
  );

  return (command, args) => {
    switch (command) {
      case "write_scan_ticks":
      case "record_recent_view":
      case "open_in_editor":
        return null;
      case "list_views":
        return { views: given.views ?? [], refused: [] };
      case "read_recent_views":
        return [];
      case "take_pending_view":
        return null;
      case "core_call":
        break;
      default:
        return undefined;
    }

    const request = (args.args ?? {}) as Record<string, unknown>;

    switch (args.op) {
      case "scan.ticks":
        return {
          ok: afterTickChanges(
            request.ticks as never,
            request.changes as never,
          ),
        };
      case "scan.estimate": {
        const history = recording.answers["scan.history"] as
          | ScanHistory
          | undefined;

        return history === undefined
          ? undefined
          : {
              ok: estimateFrom(history, request as unknown as EstimateRequest),
            };
      }
      case "scan.start":
        return recorded.has(commandKey(command, args))
          ? undefined
          : started?.reply;
      case "view.parse": {
        const parsed = parseViewFile(String(request.text));

        return {
          ok: parsed.ok
            ? { ok: true, view: { ...parsed.view }, warnings: parsed.warnings }
            : { ok: false, reason: parsed.reason },
        };
      }
      case "view.serialise":
        return { ok: { text: serialiseView(request.view as never) } };
      case "scan.stop":
      case "results.clear":
        return { ok: null };
      default:
        return undefined;
    }
  };
}
