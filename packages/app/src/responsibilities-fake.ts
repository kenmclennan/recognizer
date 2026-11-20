import type { ResponsibilitiesPort } from "./responsibilities-port";
import { NO_FILES, type ResponsibilityFiles } from "./responsibility-model";

export type FakeResponsibilities = ResponsibilitiesPort & {
  files: ResponsibilityFiles;
  reads: number;
  edit(files: ResponsibilityFiles): void;
};

export function fakeResponsibilities(
  initial: ResponsibilityFiles = NO_FILES,
): FakeResponsibilities {
  const listeners = new Set<() => void>();
  const fake: FakeResponsibilities = {
    files: initial,
    reads: 0,
    async read() {
      fake.reads += 1;

      return fake.files;
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
  };

  return fake;
}
