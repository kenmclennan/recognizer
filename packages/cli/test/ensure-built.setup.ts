import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureBuilt } from "../../../tools/scripts/ensure-built.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export default async function setup(): Promise<void> {
  await ensureBuilt(REPO, () => {
    const result = spawnSync("npm", ["run", "pretest", "-w", "recognizer"], {
      cwd: REPO,
      stdio: "inherit",
    });

    if (result.status !== 0) {
      throw new Error("npm run pretest -w recognizer failed");
    }
  });
}
