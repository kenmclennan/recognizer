import type { ScanFileText } from "../ports/scan-cache.js";
import type {
  HistoricalPorts,
  HistoricalScanOutcome,
} from "./historical-ports.js";

export type Failed = { ok: false; reason: string };

const COMMIT = /^[0-9a-f]{7,64}$/;

export function validCommit(commit: string): boolean {
  return COMMIT.test(commit);
}

export function short(commit: string): string {
  return commit.slice(0, 7);
}

export function notACommit(ref: string): Failed {
  return { ok: false, reason: `not a commit in this repository: ${ref}` };
}

function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line !== "") ?? ""
  );
}

function failureLine(outcome: HistoricalScanOutcome, stderr: string): string {
  const first = firstLine(stderr);

  if (first !== "") {
    return first;
  }

  if (outcome.status === "failed" && outcome.reason === "invalid-request") {
    return outcome.messages[0] ?? "recognizer exited 2";
  }

  if (outcome.status === "failed" && outcome.reason === "crashed") {
    return (
      (outcome.error as { message?: string } | null)?.message ??
      "recognizer exited 1"
    );
  }

  if (outcome.status === "refused" && outcome.reason === "preflight") {
    return outcome.gaps[0]?.line ?? "recognizer exited 4";
  }

  if (outcome.status === "refused") {
    return "recognizer exited 5";
  }

  return outcome.status === "stopped"
    ? "recognizer exited 143"
    : "recognizer exited 1";
}

async function runScan(
  ports: HistoricalPorts,
  folder: string,
): Promise<{ outcome: HistoricalScanOutcome; stderr: string }> {
  const running = ports.scan.start({
    repository: folder,
    mode: "incremental",
    sensors: null,
    describe: false,
    analysis: true,
    ignoreRetiredConfig: true,
    invocation: [folder, "--ignore-retired-config"],
  });
  let stderr = "";

  try {
    for await (const event of running.events) {
      if (event.type === "notice" && event.stream === "stderr") {
        stderr += `${event.text}\n`;
      }
    }
  } catch {}

  return { outcome: await running.outcome, stderr };
}

export async function scanAt(
  ports: HistoricalPorts,
  root: string,
  commit: string,
  paths: readonly string[],
): Promise<{ ok: true; scans: readonly ScanFileText[] } | Failed> {
  const folder = ports.scratch.create();

  if (folder === null) {
    return { ok: false, reason: "could not make a scratch folder" };
  }

  try {
    if (!(await ports.git.archive(root, commit, paths, folder))) {
      return { ok: false, reason: `git could not extract ${short(commit)}` };
    }

    const { outcome, stderr } = await ports.limiter.run(() =>
      runScan(ports, folder),
    );

    const read =
      outcome.status === "finished" ||
      (outcome.status === "failed" && outcome.reason === "phases");

    if (read) {
      const scans = ports.cache.read(folder);

      if (scans.length > 0) {
        return { ok: true, scans };
      }

      if (outcome.status === "finished") {
        return {
          ok: false,
          reason: `the scan found no modules at ${short(commit)}`,
        };
      }
    }

    return { ok: false, reason: failureLine(outcome, stderr) };
  } finally {
    ports.scratch.remove(folder);
  }
}
