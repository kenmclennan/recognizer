export type ToolsReport =
  | { status: "version"; version: string }
  | { status: "command-missing" }
  | { status: "failed"; exitCode: number; stderr: string };

const DOTTED = /^(\d+)\.(\d+)\.(\d+)$/;

function parse(version: string): number[] | null {
  const match = DOTTED.exec(version);

  return match === null ? null : match.slice(1).map(Number);
}

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) {
      return (a[i] as number) - (b[i] as number);
    }
  }

  return 0;
}

export function toolsNotice(
  appVersion: string,
  report: ToolsReport,
): string | null {
  if (report.status !== "version" || report.version === appVersion) {
    return null;
  }

  const tools = report.version;
  const toolsParts = parse(tools);
  const appParts = parse(appVersion);

  if (toolsParts === null || appParts === null) {
    return `The app (${appVersion}) and the recognizer command (${tools}) are out of step - run brew upgrade recognizer`;
  }

  const order = compare(toolsParts, appParts);

  if (order < 0) {
    return `The recognizer command (${tools}) is older than the app (${appVersion}) - run brew upgrade recognizer`;
  }

  if (order > 0) {
    return `The app (${appVersion}) is older than the recognizer command (${tools}) - run brew upgrade --cask recognizer`;
  }

  return null;
}
