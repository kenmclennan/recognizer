import type { NameStatusEntry } from "../shared/ports/git.js";
import type { HistoryPorts } from "./history-ports.js";

export const REF_LIMIT = 100;
export const CHANGES_LIMIT = 2000;

export interface RefFacts {
  readonly ref: string;
  readonly mergeBase: string | null;
  readonly behind: number | null;
  readonly ahead: number | null;
  readonly changes: readonly NameStatusEntry[] | null;
}

function empty(ref: string): RefFacts {
  return { ref, mergeBase: null, behind: null, ahead: null, changes: null };
}

async function factsFor(
  ports: HistoryPorts,
  root: string,
  base: string,
  ref: string,
  limit: number,
): Promise<RefFacts> {
  const { git, limiter } = ports;
  const resolved = await limiter.run(async () => git.resolveRef(root, ref));

  if (resolved === null) {
    return empty(ref);
  }

  const mergeBase = await limiter.run(() => git.mergeBase(root, base, ref));
  const counts = await limiter.run(() => git.aheadBehind(root, base, ref));
  const diff = await limiter.run(() => git.diffRefs(root, base, ref));

  return {
    ref,
    mergeBase,
    behind: counts?.behind ?? null,
    ahead: counts?.ahead ?? null,
    changes: diff !== null && diff.length <= limit ? diff : null,
  };
}

export async function readRefFacts(
  ports: HistoryPorts,
  root: string,
  refs: readonly string[],
  changesLimit: number = CHANGES_LIMIT,
): Promise<RefFacts[]> {
  const base = ports.git.defaultRef(root);
  const facts: RefFacts[] = [];

  for (const ref of refs.slice(0, REF_LIMIT)) {
    facts.push(
      base === null
        ? empty(ref)
        : await factsFor(ports, root, base, ref, changesLimit),
    );
  }

  return facts;
}
