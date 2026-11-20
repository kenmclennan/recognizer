export type ProgressInput = {
  findings: {
    line: { text: string; link: string } | null;
    action: { label: string; openScan: boolean };
    none: readonly boolean[];
    everyChanged: boolean;
    empty: string | null;
  };
  overlays: {
    changed: readonly string[];
    groups: readonly {
      name: string;
      enabled: boolean;
      notes: readonly unknown[];
    }[];
  };
};

export type ProgressKeys = { findings: string; overlays: string };

export function progressKeys(input: ProgressInput): ProgressKeys {
  return {
    findings: JSON.stringify(input.findings),
    overlays: JSON.stringify({
      changed: [...input.overlays.changed].sort(),
      groups: input.overlays.groups.map((group) => [
        group.name,
        group.enabled,
        group.notes,
      ]),
    }),
  };
}

export function changedKeys(
  previous: ProgressKeys | null,
  next: ProgressKeys,
): { findings: boolean; overlays: boolean } {
  return {
    findings: previous === null || previous.findings !== next.findings,
    overlays: previous === null || previous.overlays !== next.overlays,
  };
}
