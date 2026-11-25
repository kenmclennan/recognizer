export function ghNotice(status: string, detail: string): string | null {
  switch (status) {
    case "missing":
      return "Pull requests need the GitHub CLI (gh). Install it from cli.github.com, then reopen this tab.";
    case "signed-out":
      return "Sign in to the GitHub CLI with gh auth login, then reopen this tab.";
    case "failed":
      return detail;
    default:
      return null;
  }
}
