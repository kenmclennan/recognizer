import type { SetupProblem } from "./doctor-report.js";

export interface RepositoryTarget {
  repository: string;
  named: boolean;
}

export function quoted(text: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(text)
    ? text
    : `'${text.replaceAll("'", "'\\''")}'`;
}

export function withRepository(
  target: RepositoryTarget,
  command: string,
): string {
  return target.named
    ? `${command} --repository ${quoted(target.repository)}`
    : command;
}

export function commandFix(command: string): SetupProblem["fix"] {
  return { text: command, command };
}

export function textFix(text: string): SetupProblem["fix"] {
  return { text, command: null };
}
