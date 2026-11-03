import { hasEntries, type StaleReport } from "./stale-report";

export type StaleMessage = {
  kind: "warning";
  text: string;
  key: string;
  update: boolean;
};

export type StaleMessageInput = {
  name: string;
  title: string;
  viewCommit: string | null;
  scanCommit: string | null;
  report: StaleReport;
};

function short(commit: string): string {
  return commit.slice(0, 7);
}

function leaf(id: string): string {
  return id.slice(id.lastIndexOf("/") + 1);
}

export function staleKey(
  name: string,
  viewCommit: string | null,
  scanCommit: string | null,
): string {
  return `view-stale:${name}:${viewCommit ?? "none"}:${scanCommit ?? "none"}`;
}

function join(clauses: string[]): string {
  if (clauses.length <= 1) {
    return clauses.join("");
  }

  return `${clauses.slice(0, -1).join(", ")} and ${clauses[clauses.length - 1]}`;
}

function clausesOf(report: StaleReport): string[] {
  const renamed = report.missing.filter((entry) => entry.renamedTo !== null);
  const missing = report.missing.filter((entry) => entry.renamedTo === null);
  const relations =
    (report.changed?.removed.length ?? 0) + (report.changed?.added.length ?? 0);
  const relevant = report.newlyRelevant ?? [];
  const clauses: string[] = [];

  if (renamed.length === 1) {
    clauses.push(
      `${leaf(renamed[0].path)} was renamed to ${leaf(renamed[0].renamedTo as string)}`,
    );
  } else if (renamed.length > 1) {
    clauses.push(`${renamed.length} files were renamed`);
  }

  if (missing.length === 1) {
    clauses.push(`${leaf(missing[0].path)} is missing`);
  } else if (missing.length > 1) {
    clauses.push(`${missing.length} files are missing`);
  }

  if (relations === 1) {
    clauses.push("1 relation changed");
  } else if (relations > 1) {
    clauses.push(`${relations} relations changed`);
  }

  if (relevant.length === 1) {
    clauses.push(`${leaf(relevant[0])} became relevant`);
  } else if (relevant.length > 1) {
    clauses.push(`${relevant.length} modules became relevant`);
  }

  return clauses;
}

export function staleMessage(input: StaleMessageInput): StaleMessage | null {
  const { name, title, viewCommit, scanCommit, report } = input;
  const key = staleKey(name, viewCommit, scanCommit);

  if (report.unavailable !== null) {
    const text =
      viewCommit === null
        ? `Could not compare ${title}. The view has no commit.`
        : `Could not compare ${title} with ${short(viewCommit)}. That commit could not be scanned.`;

    return { kind: "warning", text, key, update: false };
  }

  if (!hasEntries(report)) {
    return null;
  }

  return {
    kind: "warning",
    text: `${title} is out of date. Since ${short(viewCommit ?? "")}, ${join(clausesOf(report))}.`,
    key,
    update: true,
  };
}
