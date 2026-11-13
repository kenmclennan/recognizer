import { readFileSync } from "node:fs";
import { promptVersion } from "./prompt.js";

export const PROTOCOL = 1;

export const INSTALL = "brew install --cask kenmclennan/tap/recognizer";

const PACKAGE_FILE = new URL("../package.json", import.meta.url);

export function manifest() {
  const { version } = JSON.parse(readFileSync(PACKAGE_FILE, "utf8")) as {
    version: string;
  };

  return {
    kind: "describer",
    name: "claude",
    display: "Claude",
    version,
    protocol: PROTOCOL,
    install: INSTALL,
    check: true,
    long_running: false,
    time_limit_seconds: 120,
    units: ["modules"],
    settings: [],
    prompt_version: promptVersion(),
  };
}

export function manifestText(): string {
  return `${JSON.stringify(manifest(), null, 2)}\n`;
}
