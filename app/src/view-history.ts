export const HISTORY_LIMIT = 200;

export type Mark = { by: string; summary: string };

export type History<T> = {
  record: (snapshot: T, mark?: Mark) => boolean;
  back: () => T | null;
  forward: () => T | null;
  canBack: () => boolean;
  canForward: () => boolean;
  markNow: () => Mark | null;
  markNext: () => Mark | null;
  remap: (change: (snapshot: T) => T) => void;
};

export function createHistory<T>(first: T): History<T> {
  const entries: T[] = [first];
  const marks: (Mark | null)[] = [null];
  let index = 0;

  return {
    record(snapshot, mark) {
      if (JSON.stringify(snapshot) === JSON.stringify(entries[index])) {
        return false;
      }

      entries.splice(index + 1);
      marks.splice(index + 1);
      entries.push(snapshot);
      marks.push(mark ?? null);

      if (entries.length > HISTORY_LIMIT) {
        entries.shift();
        marks.shift();
      }

      index = entries.length - 1;

      return true;
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
    markNow: () => marks[index],
    markNext: () => marks[index + 1] ?? null,
    remap(change) {
      for (let at = 0; at < entries.length; at += 1) {
        entries[at] = change(entries[at]);
      }
    },
    canBack: () => index > 0,
    canForward: () => index < entries.length - 1,
  };
}
