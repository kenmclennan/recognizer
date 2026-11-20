const RUN_LOG_FOLDER = ".recognizer/cache/log";

export function runLogPath(id: string): string {
  return `${RUN_LOG_FOLDER}/${id}.json`;
}
