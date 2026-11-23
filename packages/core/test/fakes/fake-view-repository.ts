import type { View, ViewRead, ViewRepository } from "../../src/index.js";

const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export class FakeViewRepository implements ViewRepository {
  readonly views = new Map<string, View>();
  readonly invalid = new Map<string, string[]>();
  readonly written: string[] = [];
  readonly removed: string[] = [];

  names(): string[] {
    return [...this.views.keys(), ...this.invalid.keys()]
      .filter((name) => NAME.test(name))
      .sort((a, b) => a.localeCompare(b));
  }

  exists(_root: string, name: string): boolean {
    return this.views.has(name) || this.invalid.has(name);
  }

  read(_root: string, name: string): ViewRead {
    const messages = this.invalid.get(name);

    if (messages !== undefined) {
      return { ok: false, messages };
    }

    const view = this.views.get(name);

    if (view === undefined) {
      throw new Error(`no view file ${name}`);
    }

    return { ok: true, view };
  }

  write(_root: string, name: string, view: View): void {
    this.views.set(name, view);
    this.written.push(name);
  }

  remove(_root: string, name: string): void {
    this.views.delete(name);
    this.invalid.delete(name);
    this.removed.push(name);
  }
}
