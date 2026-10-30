import type { WindowPort } from "./window-port";
import type { WindowState } from "./window-state";

export type FakeWindow = WindowPort & {
  published: string[];
  last(): WindowState;
};

export function fakeWindow(): FakeWindow {
  const published: string[] = [];

  return {
    published,
    async publish(text) {
      published.push(text);
    },
    last() {
      return JSON.parse(published[published.length - 1] as string);
    },
  };
}
