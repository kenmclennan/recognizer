import { appendFileSync, chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { manifestFor } from "./plugin-path.js";

export interface StubScanner {
  name: string;
  reportsTests?: boolean;
  stdout?: string;
  status?: number;
  holdSeconds?: number;
}

export function writeStubScanner(
  directory: string,
  log: string,
  stub: StubScanner,
): void {
  mkdirSync(directory, { recursive: true });

  const manifest = manifestFor("scanner", stub.name, {
    ...(stub.reportsTests === false ? {} : { reports_tests: true }),
  });
  const path = join(directory, `recognizer-scan-${stub.name}`);

  writeFileSync(
    path,
    [
      "#!/bin/sh",
      'if [ "$1" = "manifest" ]; then',
      "cat <<'RECOGNIZER_EOF'",
      JSON.stringify(manifest),
      "RECOGNIZER_EOF",
      "exit 0",
      "fi",
      'if [ "$1" = "tests" ]; then',
      `echo "${stub.name} $2" >> '${log}'`,
      ...(stub.holdSeconds === undefined
        ? []
        : [`exec sleep ${stub.holdSeconds}`]),
      "cat <<'RECOGNIZER_EOF'",
      stub.stdout ?? '{"entries":{}}',
      "RECOGNIZER_EOF",
      `exit ${stub.status ?? 0}`,
      "fi",
      "exit 0",
      "",
    ].join("\n"),
  );
  chmodSync(path, 0o755);
  appendFileSync(log, "");
}
