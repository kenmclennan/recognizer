export function assignIdentities(
  items: readonly (readonly [string, string, number])[],
): string[] {
  const counts = new Map<string, number>();

  for (const [module, qualified] of items) {
    const key = JSON.stringify([module, qualified]);

    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return items.map(([module, qualified, startLine]) => {
    const identity = `${module}::${qualified}`;

    return (counts.get(JSON.stringify([module, qualified])) ?? 0) > 1
      ? `${identity}@${startLine}`
      : identity;
  });
}
