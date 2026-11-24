import type { GitSettle } from "./git-settle.js";
import type { ScanBaseline, ScanChanges, ScanOrigin } from "./scan-baseline.js";

export interface WindowBaselineState {
  origin: ScanOrigin | null;
  baseline: ScanBaseline | null;
  published: ScanChanges | null;
  settle: GitSettle<string | null> | null;
}

export class WindowBaselines {
  private readonly windows = new Map<string, WindowBaselineState>();

  entry(window: string): WindowBaselineState {
    let state = this.windows.get(window);

    if (state === undefined) {
      state = { origin: null, baseline: null, published: null, settle: null };
      this.windows.set(window, state);
    }

    return state;
  }

  peek(window: string): WindowBaselineState | undefined {
    return this.windows.get(window);
  }

  drop(window: string): void {
    this.windows.delete(window);
  }
}
