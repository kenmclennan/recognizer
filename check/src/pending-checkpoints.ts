const pending = new Set<() => void>();

export function registerPending(promote: () => void): () => void {
  pending.add(promote);

  return () => {
    pending.delete(promote);
  };
}

export function promotePending(): void {
  for (const promote of [...pending]) {
    try {
      promote();
    } catch {}
  }

  pending.clear();
}
