export interface SetupStop {
  requested(): boolean;
  onRequest(handler: () => void): void;
  settled(): void;
}

export const NO_STOP: SetupStop = {
  requested: () => false,
  onRequest: () => {},
  settled: () => {},
};
