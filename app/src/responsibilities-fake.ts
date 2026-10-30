import type { ResponsibilitiesPort } from "./responsibilities-port";
import {
  type DescribeResult,
  NO_FILES,
  type ResponsibilityFiles,
} from "./responsibility-model";

export type FakeResponsibilities = ResponsibilitiesPort & {
  files: ResponsibilityFiles;
  described: string[];
  reads: number;
  edit(files: ResponsibilityFiles): void;
  settle(): Promise<void>;
};

export function fakeResponsibilities(
  initial: ResponsibilityFiles = NO_FILES,
  options: {
    onDescribe?: (module: string, fake: FakeResponsibilities) => void;
    result?: DescribeResult;
    hold?: boolean;
  } = {},
): FakeResponsibilities {
  const listeners = new Set<() => void>();
  const waiting: (() => void)[] = [];
  const fake: FakeResponsibilities = {
    files: initial,
    described: [],
    reads: 0,
    async read() {
      fake.reads += 1;

      return fake.files;
    },
    async describe(module) {
      fake.described.push(module);

      if (options.hold) {
        await new Promise<void>((resolve) => waiting.push(resolve));
      }

      const result = options.result ?? { status: "described" };

      if (result.status === "described") {
        options.onDescribe?.(module, fake);
      }

      return result;
    },
    onChanged(run) {
      listeners.add(run);

      return () => listeners.delete(run);
    },
    edit(files) {
      fake.files = files;

      for (const run of listeners) {
        run();
      }
    },
    async settle() {
      for (const release of waiting.splice(0)) {
        release();
      }

      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };

  return fake;
}
