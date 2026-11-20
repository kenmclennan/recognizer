import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { WindowPort } from "./window-port";

type DriveEvent = {
  request: number;
  action: string;
  args: string[];
  options: { off?: boolean };
  by: string;
};

export const windowSource: WindowPort = {
  publish: (text) =>
    invoke<void>("publish_window_state", { state: JSON.parse(text) }),
  onDrive(handler) {
    const stop = listen<DriveEvent>("window-drive", async (event) => {
      const { request, action, args, options, by } = event.payload;
      const answer = await handler({ action, args, options, by });

      await invoke<void>("answer_window_drive", {
        request,
        answer:
          answer.status === "done"
            ? {
                status: "done",
                result: { summary: answer.summary, changed: answer.changed },
              }
            : { status: "refused", reason: answer.reason },
      });
    });

    return () => void stop.then((unlisten) => unlisten());
  },
};
