import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const [, commit, output] = process.argv.slice(2);

mkdirSync(dirname(output), { recursive: true });
writeFileSync(
  output,
  JSON.stringify({
    overlay_version: 1,
    commit,
    modified: false,
    producer: { name: "fake-overlay", version: "1" },
    metrics: [
      {
        name: "line_coverage",
        type: "ratio",
        granularity: "module",
        bad: "low",
      },
    ],
    values: { line_coverage: { "shop/domain/order.py": 0.5 } },
  }),
);
