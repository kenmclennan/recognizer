import {
  NO_CHANGES,
  type ScanBaseline,
  type ScanChanges,
  type ScanFacts,
  sameChanges,
} from "../../domain/history/scan-baseline.js";
import type { WindowBaselines } from "../../domain/history/window-baselines.js";
import type { ScanBaselinePorts } from "./scan-baseline-ports.js";

export type ScanChangesPoll =
  | { changed: false }
  | { changed: true; changes: ScanChanges };

async function presentAmong(
  ports: ScanBaselinePorts,
  root: string,
  paths: readonly string[],
): Promise<Set<string>> {
  const present = new Set<string>();

  await Promise.all(
    paths.map((path) =>
      ports.limiter.run(async () => {
        if (await ports.workTree.exists(root, path)) {
          present.add(path);
        }
      }),
    ),
  );

  return present;
}

async function listing(
  ports: ScanBaselinePorts,
  baseline: ScanBaseline,
  root: string,
): Promise<string[]> {
  const listed = ports.git.listFiles(root);
  const found =
    listed ??
    (await ports.limiter.run(() =>
      ports.workTree.walk(root, "", async (directory) => {
        const present = await presentAmong(
          ports,
          root,
          baseline.markersAlong([`${directory}/x`]),
        );

        return baseline.descends(directory, present);
      }),
    ));

  return [...new Set(found)].sort();
}

export async function scanCandidates(
  ports: ScanBaselinePorts,
  baseline: ScanBaseline,
  root: string,
): Promise<string[]> {
  const paths = await listing(ports, baseline, root);
  const present = await presentAmong(ports, root, baseline.markersAlong(paths));

  return baseline.candidates(paths, present);
}

async function differs(
  ports: ScanBaselinePorts,
  baseline: ScanBaseline,
  root: string,
  path: string,
  recorded: string,
): Promise<boolean> {
  const stamp = await ports.workTree.stamp(root, path);

  if (stamp === null) {
    return false;
  }

  const key = `${stamp.modified}:${stamp.length}`;

  if (baseline.isVerified(path, key)) {
    return false;
  }

  const hash = await ports.workTree.hash(root, path);

  if (hash === null) {
    return false;
  }

  if (hash === recorded) {
    baseline.verify(path, key);

    return false;
  }

  return true;
}

async function gather(
  ports: ScanBaselinePorts,
  baseline: ScanBaseline,
  root: string,
): Promise<ScanFacts> {
  const missing = new Set<string>();
  const modified = new Set<string>();

  await Promise.all(
    [...baseline.hashes].map(([path, recorded]) =>
      ports.limiter.run(async () => {
        if (!(await ports.workTree.isFile(root, path))) {
          missing.add(path);
        } else if (await differs(ports, baseline, root, path, recorded)) {
          modified.add(path);
        }
      }),
    ),
  );

  const paths = await listing(ports, baseline, root);
  const present = await presentAmong(ports, root, baseline.markersAlong(paths));
  const appearing = new Set<string>();

  await Promise.all(
    baseline.absentPaths().map((path) =>
      ports.limiter.run(async () => {
        if (await ports.workTree.isFile(root, path)) {
          appearing.add(path);
        }
      }),
    ),
  );

  return {
    missing,
    modified,
    listing: paths,
    present,
    appearing,
    head: { branch: ports.git.branch(root), commit: ports.git.commit(root) },
  };
}

export async function compareScanBaseline(
  ports: ScanBaselinePorts,
  baseline: ScanBaseline,
  root: string,
): Promise<ScanChanges> {
  return baseline.compare(await gather(ports, baseline, root));
}

export async function pollScanChanges(
  ports: ScanBaselinePorts,
  windows: WindowBaselines,
  window: string,
  root: string,
): Promise<ScanChangesPoll> {
  const state = windows.peek(window);
  const baseline = state?.baseline ?? null;

  if (state === undefined || baseline === null) {
    return { changed: false };
  }

  const found = await compareScanBaseline(ports, baseline, root);

  if (
    state.baseline === null ||
    sameChanges(state.published ?? NO_CHANGES, found)
  ) {
    return { changed: false };
  }

  state.published = found;

  return { changed: true, changes: found };
}
