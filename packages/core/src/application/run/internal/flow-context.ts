import type { ScanEvent } from "../../../domain/scan-event.js";
import type { ScanSink } from "../../../domain/scan-sink.js";
import type { HeldLock } from "../../shared/ports/store.js";

export class FlowContext implements ScanSink {
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
