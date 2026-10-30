export type LinkedView = { open: string } | { refuse: string };

export function resolveLinkedView(
  viewNames: readonly string[],
  pending: string,
): LinkedView {
  return viewNames.includes(pending)
    ? { open: pending }
    : { refuse: `${pending} is not a saved view in this repository` };
}
