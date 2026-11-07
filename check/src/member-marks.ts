import type { MarkedModule } from "./change-marks.js";
import type { RecordedScan, ScanMember } from "./scan.js";

export type MemberMarkKind = "added" | "modified" | "removed";

export type MemberScan = Pick<RecordedScan, "modules">;

export type MemberFile = {
  path: string;
  base_text: string | null;
  head_text: string | null;
};

export type MemberMarksInput = {
  modules: MarkedModule[];
  headCommit: string;
  current: RecordedScan[];
  base: MemberScan[] | null;
  files: MemberFile[] | null;
};

export const MEMBER_TEXT_LIMIT = 2 * 1024 * 1024;

type Occurrence = { text: string; own: string | null };

function trimTrailingBlank(lines: string[]): string {
  let end = lines.length;

  while (end > 0 && (lines[end - 1] as string).trim() === "") {
    end -= 1;
  }

  return lines.slice(0, end).join("\n");
}

function membersOf(scans: MemberScan[], module: string): ScanMember[] | null {
  for (const scan of scans) {
    const found = scan.modules.find((entry) => entry.id === module);

    if (found !== undefined) {
      return found.members ?? [];
    }
  }

  return null;
}

type Span = { start: number; end: number };

function siblingEnd(
  starts: number[],
  line: number,
  endLine: number | undefined,
  parentEnd: number,
): number {
  if (endLine !== undefined) {
    return endLine;
  }

  const next = starts.filter((start) => start > line).sort((a, b) => a - b)[0];

  return next === undefined ? parentEnd : next - 1;
}

function sliceLines(lines: string[], span: Span): string[] {
  return lines.slice(Math.max(span.start - 1, 0), Math.max(span.end, 0));
}

function collect(
  members: ScanMember[],
  lines: string[],
): Map<string, Occurrence[]> {
  const result = new Map<string, Occurrence[]>();
  const add = (key: string, occurrence: Occurrence) => {
    result.set(key, [...(result.get(key) ?? []), occurrence]);
  };
  const topStarts = members.flatMap((m) =>
    m.line === undefined ? [] : [m.line],
  );

  for (const member of members) {
    if (member.line === undefined) {
      add(member.name, { text: "", own: null });

      continue;
    }

    const end = siblingEnd(
      topStarts,
      member.line,
      member.end_line,
      lines.length,
    );
    const span = { start: member.line, end };
    const methods = member.methods ?? [];
    const methodStarts = methods.flatMap((m) =>
      m.line === undefined ? [] : [m.line],
    );
    const cut = new Set<number>();

    for (const method of methods) {
      if (method.line === undefined) {
        add(`${member.name}.${method.name}`, { text: "", own: null });

        continue;
      }

      const methodSpan = {
        start: method.line,
        end: siblingEnd(methodStarts, method.line, method.end_line, end),
      };

      for (let n = methodSpan.start; n <= methodSpan.end; n += 1) {
        cut.add(n);
      }

      add(`${member.name}.${method.name}`, {
        text: trimTrailingBlank(sliceLines(lines, methodSpan)),
        own: null,
      });
    }

    const own: string[] = [];

    for (let n = span.start; n <= span.end; n += 1) {
      if (!cut.has(n) && n - 1 < lines.length) {
        own.push(lines[n - 1] as string);
      }
    }

    add(member.name, {
      text: trimTrailingBlank(sliceLines(lines, span)),
      own: methods.length > 0 ? trimTrailingBlank(own) : null,
    });
  }

  return result;
}

function joined(occurrences: Occurrence[]): string {
  return occurrences.map((occurrence) => occurrence.text).join("\n\u0000\n");
}

function joinedOwn(occurrences: Occurrence[]): string {
  return occurrences
    .map((occurrence) => occurrence.own ?? "")
    .join("\n\u0000\n");
}

function linesOf(text: string): string[] {
  return text.split("\n");
}

function compare(
  start: Map<string, Occurrence[]>,
  end: Map<string, Occurrence[]>,
): Map<string, MemberMarkKind> {
  const marks = new Map<string, MemberMarkKind>();

  for (const key of end.keys()) {
    if (!start.has(key)) {
      marks.set(key, "added");
    }
  }

  for (const key of start.keys()) {
    if (!end.has(key)) {
      marks.set(key, "removed");
    }
  }

  const keys = [...start.keys()].filter((key) => end.has(key));
  const methods = keys.filter((key) => key.includes("."));
  const parents = keys.filter((key) => !key.includes("."));

  for (const key of methods) {
    if (
      joined(start.get(key) as Occurrence[]) !==
      joined(end.get(key) as Occurrence[])
    ) {
      marks.set(key, "modified");
    }
  }

  const marked = [...marks.keys()];

  for (const key of parents) {
    const before = start.get(key) as Occurrence[];
    const after = end.get(key) as Occurrence[];
    const withMethods = [...before, ...after].some((o) => o.own !== null);
    const changed = withMethods
      ? marked.some((k) => k.startsWith(`${key}.`)) ||
        joinedOwn(before) !== joinedOwn(after)
      : joined(before) !== joined(after);

    if (changed) {
      marks.set(key, "modified");
    }
  }

  return marks;
}

export function memberMarks(
  input: MemberMarksInput,
): Map<string, Map<string, MemberMarkKind> | null> {
  const result = new Map<string, Map<string, MemberMarkKind> | null>();
  const modified = input.modules.filter(
    (entry) => entry.mark === "modified" && entry.box === "current",
  );

  if (modified.length === 0) {
    return result;
  }

  const unknownAll =
    input.base === null ||
    input.files === null ||
    input.current.length === 0 ||
    input.current.some(
      (scan) => scan.commit !== input.headCommit || scan.modified !== false,
    );

  for (const entry of modified) {
    if (unknownAll) {
      result.set(entry.id, null);

      continue;
    }

    const file = (input.files ?? []).find((f) => f.path === entry.id);
    const startMembers = membersOf(input.base as MemberScan[], entry.id);
    const endMembers = membersOf(input.current, entry.id);

    if (
      file === undefined ||
      file.base_text === null ||
      file.head_text === null ||
      file.base_text.length > MEMBER_TEXT_LIMIT ||
      file.head_text.length > MEMBER_TEXT_LIMIT ||
      startMembers === null ||
      endMembers === null
    ) {
      result.set(entry.id, null);

      continue;
    }

    result.set(
      entry.id,
      compare(
        collect(startMembers, linesOf(file.base_text)),
        collect(endMembers, linesOf(file.head_text)),
      ),
    );
  }

  return result;
}
