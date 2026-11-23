import type { ViewChange } from "./view.js";

export class ViewRange {
  static isValidRef(ref: string): boolean {
    return /^(?!.*\.\.)[A-Za-z0-9_][A-Za-z0-9_./@+-]*$/.test(ref);
  }

  static parse(text: string): ViewChange | null {
    const at = text.indexOf("..");

    if (at < 0) {
      return null;
    }

    const base = text.slice(0, at);
    const head = text.slice(at + 2);

    return ViewRange.isValidRef(base) && ViewRange.isValidRef(head)
      ? { base, head }
      : null;
  }

  static text(change: ViewChange): string {
    return `${change.base}..${change.head}`;
  }

  static chip(change: ViewChange): { text: string; title: string } {
    return {
      text:
        change.name ??
        `${ViewRange.shortRef(change.base)}..${ViewRange.shortRef(change.head)}`,
      title: ViewRange.text(change),
    };
  }

  private static shortRef(ref: string): string {
    return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(ref) ? ref.slice(0, 8) : ref;
  }
}
