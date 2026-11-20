export class ScanError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join("\n"));
  }
}
