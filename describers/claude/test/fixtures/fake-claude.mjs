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

if (mode === "padded") {
  process.stdout.write(`  \n  ${reply}  \n\n`);
  process.exit(0);
}

if (mode === "two") {
  process.stdout.write(`${reply}\nSecond line.\n`);
  process.exit(0);
}

if (mode === "blank") {
  process.stdout.write("  \n\n");
  process.exit(0);
}

process.stdout.write(`${reply}\n`);
