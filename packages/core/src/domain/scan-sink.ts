import type { ScanEvent } from "./scan-event.js";

export interface ScanSink {
  readonly stopped: boolean;
  emit(event: ScanEvent): void;
  say: (stream: "stdout" | "stderr", text: string) => void;
  human(stream: "stdout" | "stderr", text: string): void;
  flush(): Promise<void>;
}
