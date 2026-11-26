import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";

export type ExceptionCategory = "pure-domain" | "adapter-contract";

export type Exception = {
  path: string;
  category: ExceptionCategory;
  reason: string;
};

export type WiringReport = {
  flagged: string[];
  excepted: string[];
  unlisted: string[];
  stale: string[];
  timedAndWired: string[];
};

const IMPORT_PATH = /(?:from|import\(|mock\()\s*["']([^"']+)["']/g;
const BROWSER_CALLS = [
  "\\bshowExplorer\\b",
  "\\bloadedOf\\(",
  "\\bscanHostOf\\(",
];
const FACTORY_CALLS = [
  "\\bcreateRescanner\\(",
  "\\bcreateRepositoryStateHolder\\(",
  "\\bcreateScanSource\\(",
  "\\bcreateSensorsSource\\(",
  "\\brefreshOnChange\\(",
  "\\bcreate[A-Za-z]*Source\\(",
];
const CALLS = new RegExp([...BROWSER_CALLS, ...FACTORY_CALLS].join("|"));
const FACTORIES = new RegExp(FACTORY_CALLS.join("|"));
const ROOT_IMPORT =
  /import\s*\{[^}]*\bappRoot\b[^}]*\}\s*from\s*["']\.\.\/roots["']/;
const TIMING_CALL = /\btimeEndToEnd\(/;

export function wiredByHand(text: string): boolean {
  if (ROOT_IMPORT.test(text)) {
    return FACTORIES.test(text);
  }

  if (CALLS.test(text)) {
    return true;
  }

  for (const match of text.matchAll(IMPORT_PATH)) {
    const path = match[1] ?? "";

    if (!path.startsWith(".")) {
      continue;
    }

    if (path.endsWith("look-support")) {
      return true;
    }

    if (/src\/[a-z-]+-fake$/.test(path)) {
      return true;
    }
  }

  return false;
}

export function callsTimingHelper(text: string): boolean {
  return TIMING_CALL.test(text);
}

function testFilesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return entry.name === "node_modules" ? [] : testFilesUnder(path);
    }

    return entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

export function listTestFiles(
  repositoryRoot: string,
  testDirectory: string,
): string[] {
  const tracked = (() => {
    try {
      return execFileSync(
        "git",
        [
          "ls-files",
          "--cached",
          "--others",
          "--exclude-standard",
          "--",
          testDirectory,
        ],
        {
          cwd: repositoryRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        },
      )
        .split("\n")
        .filter((line) => line.endsWith(".test.ts"));
    } catch {
      return null;
    }
  })();

  const files =
    tracked === null || tracked.length === 0
      ? testFilesUnder(join(repositoryRoot, testDirectory)).map((file) =>
          relative(repositoryRoot, file),
        )
      : tracked;

  return files.filter((file) => existsSync(join(repositoryRoot, file))).sort();
}

export function adapterStems(adaptersDirectory: string): Set<string> {
  if (!existsSync(adaptersDirectory)) {
    return new Set();
  }

  return new Set(
    readdirSync(adaptersDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) =>
        readdirSync(join(adaptersDirectory, entry.name))
          .filter((name) => name.endsWith(".ts"))
          .map((name) => name.replace(/\.ts$/, "")),
      ),
  );
}

export function sourceStems(sourceDirectory: string): Set<string> {
  if (!existsSync(sourceDirectory)) {
    return new Set();
  }

  return new Set(
    readdirSync(sourceDirectory)
      .filter((name) => name.endsWith("-source.ts"))
      .map((name) => name.replace(/\.ts$/, "")),
  );
}

export function adapterContractReason(
  file: string,
  stems: Set<string>,
): string | null {
  const stem = basename(file).replace(/\.test\.ts$/, "");

  for (const known of stems) {
    if (stem === known || stem.startsWith(`${known}-`)) {
      return `its subject is the adapter ${known}, so it constructs it by design`;
    }
  }

  return null;
}

export function checkWiring(options: {
  repositoryRoot: string;
  testDirectory: string;
  baseline: string[];
  exceptions: Exception[];
  stems: Set<string>;
  detect?: (text: string) => boolean;
}): WiringReport {
  const detect = options.detect ?? wiredByHand;
  const files = listTestFiles(options.repositoryRoot, options.testDirectory);
  const flagged: string[] = [];
  const timedAndWired: string[] = [];

  for (const file of files) {
    const text = readFileSync(join(options.repositoryRoot, file), "utf8");

    if (detect(text)) {
      flagged.push(file);

      if (callsTimingHelper(text)) {
        timedAndWired.push(file);
      }
    }
  }

  const named = new Set(options.exceptions.map(({ path }) => path));
  const baseline = new Set(options.baseline);
  const excepted = flagged.filter(
    (file) =>
      named.has(file) || adapterContractReason(file, options.stems) !== null,
  );
  const unlisted = flagged.filter(
    (file) => !excepted.includes(file) && !baseline.has(file),
  );
  const stale = options.baseline.filter(
    (line) => !flagged.includes(line) || excepted.includes(line),
  );

  return { flagged, excepted, unlisted, stale, timedAndWired };
}

export function readBaseline(path: string): string[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}
