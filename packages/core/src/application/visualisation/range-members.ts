import { ViewRange } from "../../domain/visualisation/view-range.js";
import type { HistoricalPorts } from "./internal/historical-ports.js";
import { type Failed, notACommit, scanAt } from "./internal/historical-scan.js";
import type { ScanFileText } from "./ports/scan-cache.js";

export const MEMBER_FILE_LIMIT = 200;
export const MEMBER_TEXT_LIMIT = 2 * 1024 * 1024;

export interface MemberFileTexts {
  path: string;
  basePath: string;
  baseText: string | null;
  headText: string | null;
}

export type RangeMembers =
  | {
      ok: true;
      baseScans: readonly ScanFileText[];
      headScans: readonly ScanFileText[];
      files: MemberFileTexts[];
    }
  | Failed;

export function rangeMembers(
  ports: HistoricalPorts,
  root: string,
  base: string,
  head: string,
): Promise<RangeMembers> {
  const resolved = (ref: string): string | Failed =>
    (ViewRange.isValidRef(ref) ? ports.git.resolveRef(root, ref) : null) ??
    notACommit(ref);
  const baseCommit = resolved(base);

  if (typeof baseCommit !== "string") {
    return Promise.resolve(baseCommit);
  }

  const headCommit = resolved(head);

  if (typeof headCommit !== "string") {
    return Promise.resolve(headCommit);
  }

  return ports.comparisons.once(
    `${root}\0${baseCommit}\0${headCommit}\0members`,
    () => membersIn(ports, root, baseCommit, headCommit),
  );
}

async function membersIn(
  ports: HistoricalPorts,
  root: string,
  base: string,
  head: string,
): Promise<RangeMembers> {
  const entries = ports.git.nameStatus(root, base, head);

  if (entries === null) {
    return { ok: false, reason: `git could not diff ${base}...${head}` };
  }

  const pairs = entries
    .filter((entry) => entry.status === "M" || entry.status === "R")
    .map((entry) => ({ basePath: entry.from ?? entry.path, path: entry.path }));

  if (pairs.length === 0) {
    return { ok: false, reason: "no modified files in this range" };
  }

  if (pairs.length > MEMBER_FILE_LIMIT) {
    return {
      ok: false,
      reason: `${pairs.length} modified files, over the limit of ${MEMBER_FILE_LIMIT}`,
    };
  }

  const baseScans = await scanAt(
    ports,
    root,
    base,
    pairs.map((pair) => pair.basePath),
  );

  if (!baseScans.ok) {
    return baseScans;
  }

  const headScans = await scanAt(
    ports,
    root,
    head,
    pairs.map((pair) => pair.path),
  );

  if (!headScans.ok) {
    return headScans;
  }

  const files: MemberFileTexts[] = [];

  for (const { basePath, path } of pairs) {
    files.push({
      path,
      basePath,
      baseText: await ports.git.showText(
        root,
        base,
        basePath,
        MEMBER_TEXT_LIMIT,
      ),
      headText: await ports.git.showText(root, head, path, MEMBER_TEXT_LIMIT),
    });
  }

  return {
    ok: true,
    baseScans: baseScans.scans,
    headScans: headScans.scans,
    files,
  };
}
