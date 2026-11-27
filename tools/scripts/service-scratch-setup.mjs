import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default function setup(project) {
  const scratch = mkdtempSync(join(tmpdir(), "service-scratch-"));

  project.provide("serviceScratch", scratch);

  return () => {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 10 });
  };
}
