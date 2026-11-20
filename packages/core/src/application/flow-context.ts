import type { ScanEvent } from "../domain/index.js";
import type { HeldLock } from "../ports/driven/index.js";

export class FlowContext {
  lock: HeldLock | null = null;
  stopped = false;
  flush: () => Promise<void> = () => Promise.resolve();

  constructor(
    readonly takeLock: boolean,
    private readonly sink: (event: ScanEvent) => void,
  ) {}

  emit(event: ScanEvent): void {
    this.lock?.append(event);
    this.sink(event);
  }

  say = (stream: "stdout" | "stderr", text: string): void => {
    this.sink({ type: "notice", stream, text, humanOnly: false });
  };

  human(stream: "stdout" | "stderr", text: string): void {
    this.sink({ type: "notice", stream, text, humanOnly: true });
  }
}
