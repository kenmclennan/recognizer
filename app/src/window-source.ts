import { invoke } from "@tauri-apps/api/core";
import type { WindowPort } from "./window-port";

export const windowSource: WindowPort = {
  publish: (text) =>
    invoke<void>("publish_window_state", { state: JSON.parse(text) }),
};
