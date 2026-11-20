import type { ScanSink } from "../../domain/scan-sink.js";
import type { ScanningQueries } from "./internal/scanning-ports.js";

export interface DetectLanguagesInput {
  root: string;
  named: Record<string, string>;
  installed: number;
  sink: ScanSink;
}

export function detectLanguages(
  ports: ScanningQueries,
  { root, named, installed, sink }: DetectLanguagesInput,
): string[] {
  const detected = ports.scanners.detect(root, named);

  if (detected.length === 0) {
    if (installed === 0) {
      sink.say(
        "stderr",
        "no scanner is installed: recognizer plugins lists what is installed\n",
      );
    }

    sink.say("stderr", "no languages detected\n");
  }

  return detected;
}
