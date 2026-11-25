import { readFileSync } from "node:fs";
import type { Program } from "./io/processes.js";
import { sensorManifest } from "./sensor-program.js";

export const TEST_FILE = "api/src/memory-store.test.ts";

export const SOURCE_FILE = "api/src/memory-store.ts";

export function realText(path: string): string {
  return readFileSync(path, "utf8");
}

export class Digest {
  value = "";
}

export function gaugeProgram(digest: Digest): Program {
  return (call) => {
    const [verb, ...rest] = call.args;
    const done = { started: true, status: 0, stderr: "" };

    if (verb === "manifest") {
      return { ...done, stdout: sensorManifest("gauge") };
    }

    if (verb === "--version") {
      return { ...done, stdout: "1\n" };
    }

    if (verb === "check") {
      return { ...done, stdout: '{"gaps":[]}' };
    }

    const at = (flag: string) => rest[rest.indexOf(flag) + 1] ?? "";
    const root = at("--repository");
    const hash = call.files.hashFile(`${root}/${SOURCE_FILE}`);

    call.files.writeFile(
      at("--output"),
      JSON.stringify({
        findings_version: 2,
        sensor: { name: "gauge", version: "1" },
        commit: at("--commit"),
        modified: false,
        settings: {},
        findings: [],
        inputs: { [SOURCE_FILE]: hash },
        tests: digest.value,
      }),
    );

    return { ...done, stdout: "" };
  };
}
