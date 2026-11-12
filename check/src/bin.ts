#!/usr/bin/env node
import { run, stopEverything } from "./cli.js";

for (const [signal, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
] as const) {
  process.on(signal, () => {
    stopEverything(code);
    process.exit(code);
  });
}

process.exitCode = await run(process.argv.slice(2));
