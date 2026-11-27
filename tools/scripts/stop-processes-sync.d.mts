export function stopProcessesSync(
  pids: number[],
  options?: { graceMs?: number; stepMs?: number },
): boolean;
