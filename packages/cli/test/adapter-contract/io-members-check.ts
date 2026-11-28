export interface IoMembersInput {
  keys: readonly string[];
  files: readonly string[];
  timers: readonly string[];
  other: readonly string[];
  filesCovered: ReadonlySet<string>;
  timersCovered: ReadonlySet<string>;
}

export interface IoMembersReport {
  unclassified: string[];
  stale: string[];
  uncovered: string[];
}

export function checkIoMembers(input: IoMembersInput): IoMembersReport {
  const listed = [...input.files, ...input.timers, ...input.other];
  const real = new Set(input.keys);

  return {
    unclassified: input.keys.filter((key) => !listed.includes(key)),
    stale: listed.filter((name) => !real.has(name)),
    uncovered: [
      ...input.files.filter((name) => !input.filesCovered.has(name)),
      ...input.timers.filter((name) => !input.timersCovered.has(name)),
    ],
  };
}
