import { spawnSync } from "node:child_process";
import { existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";

const SYSTEM_DIRECTORIES = ["/usr/bin", "/bin"];
const TOOLS = ["uv", "git", "cargo", "rustc"];

let toolDirectory: string | undefined;

function located(name: string): string {
  const result = spawnSync("which", [name], { encoding: "utf8" });

  return result.status === 0 ? result.stdout.trim() : "";
}

function tools(): string {
  if (toolDirectory !== undefined) {
    return toolDirectory;
  }

  const directory = makeTempDir("recognizer-isolated-tools-");
  const wanted: [string, string][] = [
    ["node", process.execPath],
    ...TOOLS.map((name): [string, string] => [name, located(name)]),
  ];

  for (const [name, target] of wanted) {
    if (target !== "" && !existsSync(join(directory, name))) {
      symlinkSync(target, join(directory, name));
    }
  }

  toolDirectory = directory;

  return directory;
}

export function isolatedPath(...directories: string[]): string {
  return [...directories, tools(), ...SYSTEM_DIRECTORIES].join(":");
}
