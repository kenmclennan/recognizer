import type { DriveRequest } from "./window-drive";

export type DriveAnswer =
  | { status: "done"; summary: string; changed: boolean }
  | { status: "refused"; reason: string };

export type DriveHandler = (request: DriveRequest) => Promise<DriveAnswer>;

export type WindowPort = {
  publish(text: string): Promise<void>;
  onDrive(handler: DriveHandler): () => void;
};

export const inertWindow: WindowPort = {
  publish: async () => {},
  onDrive: () => () => {},
};
