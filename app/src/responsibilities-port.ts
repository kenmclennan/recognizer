import { NO_FILES, type ResponsibilityFiles } from "./responsibility-model";

export type ResponsibilitiesPort = {
  read(): Promise<ResponsibilityFiles>;
  onChanged(run: () => void): () => void;
};

export const inertResponsibilities: ResponsibilitiesPort = {
  read: async () => NO_FILES,
  onChanged: () => () => {},
};
