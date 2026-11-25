import { readFileSync } from "node:fs";
import { promptVersion } from "./prompt.js";

export const PROTOCOL = 3;

export const INSTALL =
  "brew upgrade kenmclennan/tap/recognizer-describe-claude || brew install kenmclennan/tap/recognizer-describe-claude";

const PACKAGE_FILE = new URL("../package.json", import.meta.url);

export function manifest() {
  const { version } = JSON.parse(readFileSync(PACKAGE_FILE, "utf8")) as {
    version: string;
  };

  return {
    kind: "describer",
    name: "claude",
    display: "Claude",
    description:
      "Writes a one-line description of each file with Claude, only when you ask, using your Claude account.",
    version,
    protocol: PROTOCOL,
    install: INSTALL,
    check: true,
    long_running: false,
    time_limit_seconds: 120,
    units: ["files"],
    settings: [],
    prompt_version: promptVersion(),
  };
}

export function manifestText(): string {
  return `${JSON.stringify(manifest(), null, 2)}\n`;
}
