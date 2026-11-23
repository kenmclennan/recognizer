import type { DoctorReport } from "@recognizer/core";

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
      lines.push(
        `  ${problem.severity === "warning" ? "warning: " : ""}${problem.line}`,
        `    fix: ${problem.fix.text}`,
      );
    }
  }

  lines.push(
    report.ok
      ? "No problems"
      : `${report.problems} ${report.problems === 1 ? "problem" : "problems"}`,
  );

  if (report.warnings > 0) {
    lines.push(
      `${report.warnings} ${report.warnings === 1 ? "warning" : "warnings"}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

export function reportJson(report: DoctorReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
