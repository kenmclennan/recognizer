import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { isolatedPath } from "./isolated-path.js";
import { registerShim } from "./plugin-registry-shim.js";
import { scannerManifestText } from "./support/manifest-text.js";

export {
  describerManifestText,
  scannerManifestText,
} from "./support/manifest-text.js";

export function useScannerShim(language: string): () => void {
  const directory = makeTempDir("recognizer-scanner-shim-");
  const saved = process.env.PATH;
  const path = join(directory, `recognizer-scan-${language}`);

  writeFileSync(
    path,
    `#!/bin/sh\nif [ "$1" = "manifest" ]; then\ncat <<'EOF'\n${scannerManifestText(language).trim()}\nEOF\nfi\n`,
  );
  chmodSync(path, 0o755);
  registerShim(path);
  process.env.PATH = isolatedPath(directory);

  return () => {
    process.env.PATH = saved;
  };
}

export * from "./support/scan-fake-io.js";
