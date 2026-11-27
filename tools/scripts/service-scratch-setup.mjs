import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeScratch } from "./service-scratch-teardown.mjs";

export default function setup(project) {
  const scratch = mkdtempSync(join(tmpdir(), "service-scratch-"));

  project.provide("serviceScratch", scratch);

  return async () => {
    await removeScratch(scratch);
  };
}
