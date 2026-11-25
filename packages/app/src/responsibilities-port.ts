import { NO_STATES, type ResponsibilityRead } from "./responsibility-model";

export type ResponsibilitiesPort = {
  read(modules: string[]): Promise<ResponsibilityRead>;
  onChanged(run: () => void): () => void;
};

export const inertResponsibilities: ResponsibilitiesPort = {
  read: async () => NO_STATES,
  onChanged: () => () => {},
};
