import type { MessageInput } from "./message-tray";

export type ToolsReport =
  | { status: "version"; version: string }
  | { status: "command-missing" }
  | { status: "failed"; exitCode: number; stderr: string };

export const UPGRADE_TOOLS = "brew upgrade recognizer";

export const UPGRADE_APP = "brew upgrade --cask recognizer";

const DOTTED = /^(\d+)\.(\d+)\.(\d+)$/;

function parse(version: string): number[] | null {
  const match = DOTTED.exec(version);

  return match === null ? null : match.slice(1).map(Number);
}

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) {
      return (a[i] as number) - (b[i] as number);
    }
  }

  return 0;
}

export type ToolsMessage = { text: string; command: string };

export function toolsNotice(
  appVersion: string,
  report: ToolsReport,
): ToolsMessage | null {
  if (report.status !== "version" || report.version === appVersion) {
    return null;
  }

  const tools = report.version;
  const toolsParts = parse(tools);
  const appParts = parse(appVersion);

  if (toolsParts === null || appParts === null) {
    return {
      text: `The app (${appVersion}) and the recognizer command (${tools}) are out of step`,
      command: UPGRADE_TOOLS,
    };
  }

  const order = compare(toolsParts, appParts);

  if (order < 0) {
    return {
      text: `The recognizer command (${tools}) is older than the app (${appVersion})`,
      command: UPGRADE_TOOLS,
    };
  }

  if (order > 0) {
    return {
      text: `The app (${appVersion}) is older than the recognizer command (${tools})`,
      command: UPGRADE_APP,
    };
  }

  return null;
}

export const TOOLS_KEY = "tools-version";

export type ToolsMessageSink = {
  post: (input: MessageInput) => number | null;
  relabel: (id: number, label: string) => void;
};

export function postToolsMessage(
  notice: ToolsMessage,
  sink: ToolsMessageSink,
  copy: (text: string) => Promise<void>,
): number | null {
  let id: number | null = null;

  id = sink.post({
    kind: "warning",
    text: notice.text,
    key: TOOLS_KEY,
    onOpen: true,
    action: {
      label: "Upgrade",
      run() {
        void copy(notice.command)
          .then(() => {
            if (id !== null) {
              sink.relabel(id, "Copied");
            }
          })
          .catch(() => {});
      },
    },
  });

  return id;
}
