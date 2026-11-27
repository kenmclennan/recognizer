export function writersIn(scratch: string, listing?: string): number[];
export function removeScratch(
  scratch: string,
  options?: {
    graceMs?: number;
    killMs?: number;
    stepMs?: number;
    warn?: (message: string) => void;
  },
): Promise<boolean>;
