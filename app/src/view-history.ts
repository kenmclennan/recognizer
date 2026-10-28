export const HISTORY_LIMIT = 200;

export type History<T> = {
  record: (snapshot: T) => void;
  back: () => T | null;
  forward: () => T | null;
  canBack: () => boolean;
  canForward: () => boolean;
  remap: (change: (snapshot: T) => T) => void;
};

export function createHistory<T>(first: T): History<T> {
  const entries: T[] = [first];
  let index = 0;

  return {
    record(snapshot) {
      if (JSON.stringify(snapshot) === JSON.stringify(entries[index])) {
        return;
      }

      entries.splice(index + 1);
      entries.push(snapshot);

      if (entries.length > HISTORY_LIMIT) {
        entries.shift();
      }

      index = entries.length - 1;
    },
    back() {
      if (index === 0) {
        return null;
      }

      index -= 1;

      return entries[index];
    },
    forward() {
      if (index === entries.length - 1) {
        return null;
      }

      index += 1;

      return entries[index];
    },
    remap(change) {
      for (let at = 0; at < entries.length; at += 1) {
        entries[at] = change(entries[at]);
      }
    },
    canBack: () => index > 0,
    canForward: () => index < entries.length - 1,
  };
}
