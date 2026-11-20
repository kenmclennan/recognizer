export type OpenModules = {
  open: (id: string) => void;
  close: (id: string) => void;
  isOpen: (id: string) => boolean;
  count: () => number;
  total: () => number;
  opened: () => string[];
};

export function createOpenModules(ids: Iterable<string>): OpenModules {
  const known = new Set(ids);
  const open = new Set<string>();

  return {
    open(id) {
      if (known.has(id)) {
        open.add(id);
      }
    },
    close(id) {
      open.delete(id);
    },
    isOpen: (id) => open.has(id),
    count: () => open.size,
    total: () => known.size,
    opened: () => [...open],
  };
}
