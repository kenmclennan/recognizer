export type WindowPort = {
  publish(text: string): Promise<void>;
};

export const inertWindow: WindowPort = {
  publish: async () => {},
};
