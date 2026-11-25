import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { FakeContract } from "./fake-contracts.js";

export interface ContractReport {
  found: string[];
  registered: string[];
  baselined: string[];
  badProofs: string[];
  unlisted: string[];
  stale: string[];
}

export function fakesUnder(root: string, directories: string[]): string[] {
  return directories
    .flatMap((directory) =>
      existsSync(join(root, directory))
        ? readdirSync(join(root, directory))
            .filter((name) => /^fake-.*\.ts$/.test(name))
            .map((name) => `${directory}/${name}`)
        : [],
    )
    .sort();
}

export function baselineLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

function proofProblem(root: string, entry: FakeContract): string | null {
  let text = "";

  for (const proof of entry.proofs) {
    if (!existsSync(join(root, proof))) {
      return `${entry.fakeName}: proof ${proof} does not exist`;
    }

    text += readFileSync(join(root, proof), "utf8");
  }

  const fakeModule = basename(entry.fake).replace(/\.ts$/, "");
  const adapterModule = basename(entry.adapter).replace(/\.ts$/, "");
  const hasFake = text.includes(fakeModule) || text.includes(entry.fakeName);
  const hasAdapter =
    text.includes(adapterModule) || text.includes(entry.adapterName);

  return hasFake && hasAdapter
    ? null
    : `${entry.fakeName}: its proof does not import both ${entry.fakeName} and ${entry.adapterName}`;
}

export function checkContracts(options: {
  root: string;
  registry: FakeContract[];
  baseline: string;
  directories: string[];
}): ContractReport {
  const { root, registry, directories } = options;
  const found = fakesUnder(root, directories);
  const baselined = baselineLines(options.baseline);
  const registered = registry.map((entry) => entry.fake);

  return {
    found,
    registered,
    baselined,
    badProofs: registry
      .map((entry) => proofProblem(root, entry))
      .filter((problem): problem is string => problem !== null),
    unlisted: found.filter(
      (fake) => !registered.includes(fake) && !baselined.includes(fake),
    ),
    stale: baselined.filter(
      (line) => !found.includes(line) || registered.includes(line),
    ),
  };
}
