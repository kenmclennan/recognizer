import type { DriveRequest } from "./window-drive";
import type { DriveAnswer, DriveHandler, WindowPort } from "./window-port";
import type { WindowState } from "./window-state";

export type FakeWindow = WindowPort & {
  published: string[];
  last(): WindowState;
  drive(request: DriveRequest): Promise<DriveAnswer>;
};

export function fakeWindow(): FakeWindow {
  const published: string[] = [];
  let handler: DriveHandler | null = null;

  return {
    published,
    async publish(text) {
      published.push(text);
    },
    onDrive(next) {
      handler = next;

      return () => {
        handler = null;
      };
    },
    drive(request) {
      if (handler === null) {
        return Promise.resolve({
          status: "refused",
          reason: "the window is not listening",
        });
      }

      return handler(request);
    },
    last() {
      return JSON.parse(published[published.length - 1] as string);
    },
  };
}
