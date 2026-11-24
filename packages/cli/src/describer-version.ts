export function describerVersion(describer: {
  command: readonly string[];
  version: string;
}): string {
  return describer.version;
}
