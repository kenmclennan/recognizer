import {
  type DescribeResult,
  NO_FILES,
  type ResponsibilityFiles,
} from "./responsibility-model";

export type ResponsibilitiesPort = {
  read(): Promise<ResponsibilityFiles>;
  describe(module: string): Promise<DescribeResult>;
  onChanged(run: () => void): () => void;
};

export const inertResponsibilities: ResponsibilitiesPort = {
  read: async () => NO_FILES,
  describe: async () => ({ status: "described" }),
  onChanged: () => () => {},
};
