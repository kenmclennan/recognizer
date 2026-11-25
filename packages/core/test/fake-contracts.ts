export interface FakeContract {
  fake: string;
  fakeName: string;
  adapter: string;
  adapterName: string;
  proofs: string[];
}

export const FAKE_CONTRACTS: FakeContract[] = [
  {
    fake: "packages/core/test/fakes/fake-git.ts",
    fakeName: "FakeGit",
    adapter: "packages/cli/src/adapters/git/git-adapter.ts",
    adapterName: "GitAdapter",
    proofs: ["packages/cli/test/git-fake-conformance.test.ts"],
  },
  {
    fake: "packages/core/test/fakes/fake-clock.ts",
    fakeName: "FakeClock",
    adapter: "packages/cli/src/adapters/system/clock-adapter.ts",
    adapterName: "ClockAdapter",
    proofs: [
      "packages/cli/test/adapter-contract/clock-adapter-contract.test.ts",
    ],
  },
  {
    fake: "packages/core/test/fakes/fake-process.ts",
    fakeName: "FakeProcess",
    adapter: "packages/cli/src/adapters/plugins/process-adapter.ts",
    adapterName: "ProcessAdapter",
    proofs: [
      "packages/cli/test/adapter-contract/process-adapter-contract.test.ts",
    ],
  },
  {
    fake: "packages/core/test/fakes/fake-scratch.ts",
    fakeName: "FakeScratch",
    adapter: "packages/cli/src/adapters/system/scratch-adapter.ts",
    adapterName: "ScratchAdapter",
    proofs: [
      "packages/cli/test/adapter-contract/scratch-adapter-contract.test.ts",
    ],
  },
  {
    fake: "packages/core/test/fakes/fake-scan-cache.ts",
    fakeName: "FakeScanCache",
    adapter: "packages/cli/src/adapters/filesystem/scan-cache-adapter.ts",
    adapterName: "ScanCacheAdapter",
    proofs: [
      "packages/cli/test/adapter-contract/scan-cache-adapter-contract.test.ts",
    ],
  },
  {
    fake: "packages/cli/test/support/fake-io.ts",
    fakeName: "FakeIo",
    adapter: "packages/cli/src/cli.ts",
    adapterName: "nodeIo",
    proofs: [
      "packages/cli/test/fake-io.test.ts",
      "packages/cli/test/adapter-contract/io-real.test.ts",
    ],
  },
];

export const FAKE_DIRECTORIES = [
  "packages/core/test/fakes",
  "packages/cli/test/support",
];
