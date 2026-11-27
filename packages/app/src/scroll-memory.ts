export type ScrollMemory = Record<string, number[]>;

export const SCROLLERS: Readonly<Record<string, string>> = {
  files: ".rows",
  notes: ".notes-panel",
  scan: ".scan-panel",
  findings: ".findings-panel",
  views: ".views-panel",
  commits: ".commits-list",
  inspector: ".inspector-panel",
};

export function readScroll(root: ParentNode): ScrollMemory {
  const memory: ScrollMemory = {};

  for (const [name, selector] of Object.entries(SCROLLERS)) {
    memory[name] = [...root.querySelectorAll<HTMLElement>(selector)].map(
      (element) => element.scrollTop,
    );
  }

  return memory;
}

export function clampOffset(
  offset: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  return Math.max(0, Math.min(offset, scrollHeight - clientHeight));
}

export function restoreScroll(root: ParentNode, memory: ScrollMemory) {
  for (const [name, selector] of Object.entries(SCROLLERS)) {
    const offsets = memory[name] ?? [];
    const elements = root.querySelectorAll<HTMLElement>(selector);

    elements.forEach((element, index) => {
      const offset = offsets[index] ?? 0;

      if (offset > 0) {
        element.scrollTop = clampOffset(
          offset,
          element.scrollHeight,
          element.clientHeight,
        );
      }
    });
  }
}

export function readPanelScroll(
  root: ParentNode,
  panel: string,
): number | null {
  const selector = SCROLLERS[panel];
  const element =
    selector === undefined ? null : root.querySelector<HTMLElement>(selector);

  return element === null ? null : element.scrollTop;
}

export function restorePanelScroll(
  root: ParentNode,
  panel: string,
  offset: number,
): boolean {
  const selector = SCROLLERS[panel];
  const element =
    selector === undefined ? null : root.querySelector<HTMLElement>(selector);

  if (element === null || element.scrollHeight <= element.clientHeight) {
    return false;
  }

  element.scrollTop = clampOffset(
    offset,
    element.scrollHeight,
    element.clientHeight,
  );

  return true;
}
