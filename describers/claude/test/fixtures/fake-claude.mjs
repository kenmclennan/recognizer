#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const record = process.env.FAKE_CLAUDE_RECORD ?? join(here, "record");

writeFileSync(`${record}.argv`, JSON.stringify(process.argv.slice(2)));
writeFileSync(`${record}.cwd`, process.cwd());
writeFileSync(`${record}.stdin`, readFileSync(0, "utf8"));
appendFileSync(`${record}.calls`, "x");

const mode = process.env.FAKE_CLAUDE_MODE ?? "reply";
const reply = process.env.FAKE_CLAUDE_REPLY ?? "Handles orders.";

if (mode === "fail") {
  process.stderr.write("claude exploded\n");
  process.exit(1);
}

if (mode === "empty") {
  process.exit(0);
}

const respond = (result) =>
  process.stdout.write(
    `${JSON.stringify({ type: "result", is_error: false, result })}\n`,
  );

const respondError = (result, status, code) => {
  process.stdout.write(
    `${JSON.stringify({
      type: "result",
      is_error: true,
      ...(status === undefined ? {} : { api_error_status: status }),
      terminal_reason: "api_error",
      result,
    })}\n`,
  );
  process.exit(code);
};

if (mode === "padded") {
  respond(`  \n  ${reply}  \n\n`);
  process.exit(0);
}

if (mode === "two") {
  respond(`${reply}\nSecond line.`);
  process.exit(0);
}

if (mode === "blank") {
  respond("  \n\n");
  process.exit(0);
}

if (mode === "plain") {
  process.stdout.write(`${reply}\n`);
  process.exit(0);
}

if (mode === "limit") {
  respondError("Claude usage limit reached", 429, 1);
}

if (mode === "limit-text") {
  respondError("You've hit your limit", undefined, 1);
}

if (mode === "notfound") {
  respondError("model not found", 404, 1);
}

if (mode === "sleep") {
  writeFileSync(`${record}.pid`, String(process.pid));
  setInterval(() => {}, 1000);
} else {
  respond(reply);
}
