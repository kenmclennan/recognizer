export const IO_FILE_MEMBERS: readonly string[] = [
  "writeFile",
  "readFile",
  "readBytes",
  "exists",
  "hashFile",
  "rename",
  "readDir",
  "remove",
  "makeTempDir",
  "removeDir",
  "modified",
  "createExclusive",
  "append",
  "stamp",
];

export const IO_TIMER_MEMBERS: readonly string[] = [
  "now",
  "awake",
  "after",
  "wait",
];

export const IO_PROCESS_MEMBERS: readonly string[] = [
  "run",
  "runAsync",
  "launch",
  "request",
];

export const IO_OTHER_MEMBERS: readonly string[] = [
  "scope",
  "readStdin",
  "readLine",
  "env",
  "pid",
  "pidAlive",
  "processGroup",
  "stdout",
  "stderr",
];
