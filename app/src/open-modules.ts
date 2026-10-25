export type OpenModules = {
  open: (id: string) => void;
  close: (id: string) => void;
  isOpen: (id: string) => boolean;
  count: () => number;
  total: () => number;
  opened: () => string[];
  select: (id: string) => void;
  selected: () => string | null;
};

export function createOpenModules(ids: Iterable<string>): OpenModules {
  const known = new Set(ids);
  const open = new Set<string>();
  let selection: string | null = null;

  return {
    open(id) {
      if (known.has(id)) {
        open.add(id);
      }
    },
    close(id) {
      open.delete(id);

      if (selection === id) {
        selection = null;
      }
    },
    isOpen: (id) => open.has(id),
    count: () => open.size,
    total: () => known.size,
    opened: () => [...open],
    select(id) {
      if (known.has(id)) {
        selection = id;
      }
    },
    selected: () => selection,
  };
}
