import type { SensorReport } from "@recognizer/core";

export function reportText(reports: SensorReport[]): string {
  return `${reports
    .flatMap((report) => {
      if (!report.checked) {
        return [`${report.name}: no readiness check`];
      }

      const notes = report.notes.map((note) => `  ${note.line}`);

      if (report.ready) {
        return [`${report.name}: ready`, ...notes];
      }

      const count = report.gaps.length;

      return [
        `${report.name}: ${count} ${count === 1 ? "gap" : "gaps"}`,
        ...report.gaps.map((gap) => `  ${gap.line}`),
        ...notes,
      ];
    })
    .join("\n")}\n`;
}

export function reportJson(reports: SensorReport[]): string {
  return `${JSON.stringify(
    {
      ready: reports.every((report) => report.ready),
      sensors: reports.map(({ name, ready, gaps, notes, work }) => ({
        name,
        ready,
        gaps,
        notes,
        ...(work === undefined ? {} : { work }),
      })),
    },
    null,
    2,
  )}\n`;
}
