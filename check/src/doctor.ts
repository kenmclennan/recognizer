export type AreaName = "config" | "policy" | "scanners" | "sensors";

export type ProblemCode = never;

export interface SetupProblem {
  code: ProblemCode;
  subject: string;
  line: string;
  fix: { text: string; command: string | null };
}

export interface Area {
  name: AreaName;
  skipped: string | null;
  problems: SetupProblem[];
}

export interface DoctorReport {
  repository: string;
  ok: boolean;
  problems: number;
  areas: Area[];
}

export interface DoctorFacts {
  repository: string;
}

export function buildReport(facts: DoctorFacts): DoctorReport {
  const areas: Area[] = [
    { name: "config", skipped: null, problems: [] },
    { name: "policy", skipped: null, problems: [] },
    { name: "scanners", skipped: null, problems: [] },
    { name: "sensors", skipped: null, problems: [] },
  ];
  const problems = areas.reduce((sum, area) => sum + area.problems.length, 0);

  return { repository: facts.repository, ok: problems === 0, problems, areas };
}

export function reportText(report: DoctorReport): string {
  const lines: string[] = [];

  for (const area of report.areas) {
    if (area.skipped !== null) {
      lines.push(`${area.name} not checked: ${area.skipped}`);

      continue;
    }

    if (area.problems.length === 0) {
      continue;
    }

    lines.push(area.name);

    for (const problem of area.problems) {
      lines.push(`  ${problem.line}`, `    fix: ${problem.fix.text}`);
    }
  }

  lines.push(
    report.ok
      ? "No problems"
      : `${report.problems} ${report.problems === 1 ? "problem" : "problems"}`,
  );

  return `${lines.join("\n")}\n`;
}

export function reportJson(report: DoctorReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
