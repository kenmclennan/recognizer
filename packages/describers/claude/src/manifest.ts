import { readFileSync } from "node:fs";
import { promptVersion } from "./prompt.js";

export const PROTOCOL = 4;

export const INSTALL =
  "brew upgrade kenmclennan/tap/recognizer-describe-claude || brew install kenmclennan/tap/recognizer-describe-claude";

export const ASSISTANT = {
  name: "Claude",
  program: "claude",
  account_note: "Uses your Claude account.",
  signed_out_reason:
    "Claude Code is not signed in. Open a terminal, run claude and sign in, then try again.",
  signed_out_markers: ["not logged in"],
  limit_markers: ["usage limit", "rate limit"],
};

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
    settings: [
      {
        key: "model",
        type: "string",
        scope: "machine",
        label: "Model",
        default: "haiku",
        description:
          "the model every description uses, for scans started from the app and from a terminal",
        example: "describing.model haiku",
        order: 1,
      },
    ],
    prices: {
      haiku: { input: 0.1, output: 0.5 },
      sonnet: { input: 2, output: 10 },
      opus: { input: 4, output: 20 },
    },
    prompt_version: promptVersion(),
    assistant: ASSISTANT,
  };
}

export function manifestText(): string {
  return `${JSON.stringify(manifest(), null, 2)}\n`;
}
