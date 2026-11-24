import type { RepositoryState } from "@recognizer/core";

export function entryOf(name: string, registered = true) {
  return {
    name,
    registered,
    manifest: {
      display: name.toUpperCase(),
      runsTests: false,
      scoped: false,
      listed: true,
      description: `${name} description`,
    },
    reason: null,
  };
}

export function snapshotOf(
  revision: number,
  names: string[],
  extra: Partial<RepositoryState> = {},
): RepositoryState {
  return {
    repository: "/repo",
    revision,
    registry: {
      catalog: { state: "read" },
      entries: names.map((name) => entryOf(name)),
    },
    run: null,
    results: {},
    freshness: {},
    unreadableReports: 0,
    inputsDigest: "d",
    ...extra,
  };
}
