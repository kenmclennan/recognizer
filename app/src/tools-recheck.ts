import {
  type ToolsMessage,
  type ToolsReport,
  toolsNotice,
} from "./tools-notice";

export const RECHECK_GAP_MS = 60_000;

export type ToolsRecheck = {
  onOpen: () => Promise<void>;
  onFocus: () => Promise<void>;
};

export function createToolsRecheck(
  deps: {
    now: () => number;
    read: () => Promise<{ appVersion: string; report: ToolsReport }>;
    show: (notice: ToolsMessage | null, fresh: boolean) => void;
  },
  minGapMs = RECHECK_GAP_MS,
): ToolsRecheck {
  let lastRun: number | null = null;
  let inFlight = false;
  let lastText: string | null = null;

  async function run(opening: boolean): Promise<void> {
    lastRun = deps.now();
    inFlight = true;

    let notice: ToolsMessage | null = null;

    try {
      const { appVersion, report } = await deps.read();

      notice = toolsNotice(appVersion, report);
    } catch {
      notice = null;
    }

    const text = notice === null ? null : notice.text;
    const fresh = opening || text !== lastText;

    lastText = text;
    inFlight = false;
    deps.show(notice, fresh);
  }

  return {
    onOpen: () => run(true),
    async onFocus() {
      if (inFlight) {
        return;
      }

      if (lastRun !== null && deps.now() - lastRun < minGapMs) {
        return;
      }

      await run(false);
    },
  };
}
