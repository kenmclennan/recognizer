import type { Scan, ScanEdge, ScanMember } from "recognizer";
import { type Counts, type Line, lastSegment, under } from "./canvas-graph";
import type { Selection } from "./canvas-state";
import {
  classHeadTokens,
  constantTokens,
  fieldTokens,
  functionTokens,
  interfaceHeadTokens,
  methodTokens,
  type Token,
  typeAliasTokens,
} from "./card-code";
import type { EvidenceSection } from "./edge-evidence";
import type { Disc, Finding } from "./health";
import { createPicker, type PickerSource } from "./picker-model";
import { type CheckState, checkState } from "./row-model";

export type InspectorTab = "contents" | "findings" | "dependencies";

export type InspectorInputs = {
  scans: Scan[];
  modules: string[];
  disc: (id: string) => Disc;
  findings: (id: string) => Finding[];
  onCanvas: (id: string) => boolean;
  expanded: ReadonlySet<string>;
  showPrivate: boolean;
  tab: InspectorTab;
  evidence: EvidenceSection[] | null;
  edgeOnCanvas: boolean;
  counts: (selection: NonNullable<Selection>) => Counts;
  filter: string;
  collapsed: ReadonlySet<string>;
  followed: Followed | null;
};

export type Direction = "uses" | "usedBy";

export type Followed = { id: string; relation: Direction };

export type CardLabel =
  | "Class"
  | "Interface"
  | "Type"
  | "Function"
  | "Constant";

export type CardLine = {
  line: number | null;
  tokens: Token[];
  private: boolean;
};

export type CardRow = {
  kind: "card";
  label: CardLabel;
  line: number | null;
  head: Token[];
  lines: CardLine[];
  hidden: string;
  private: boolean;
  hover: string;
};

export type SwitchRow = { kind: "switch"; label: "Show private"; on: boolean };

export type Row =
  | { kind: "note"; text: string }
  | { kind: "none" }
  | CardRow
  | SwitchRow
  | { kind: "fold"; key: string; text: string; open: boolean; top: boolean }
  | { kind: "filter"; value: string; placeholder: string }
  | {
      kind: "module";
      id: string;
      ids: string[];
      label: string;
      state: CheckState;
      bold: boolean;
      disc: Disc;
      folder: boolean;
      indent: boolean;
      chevron: { key: string; open: boolean } | null;
      detail: { text: string; tone?: "private" | "inferred" } | null;
      title: string;
      follow: Direction | null;
      followed: boolean;
    }
  | { kind: "group"; id: string; disc: Disc; path: string }
  | {
      kind: "finding";
      text: string;
      why: string;
      severity: Finding["severity"];
    }
  | { kind: "evidence"; section: EvidenceSection };

export type Header = {
  disc: Disc | null;
  title: string;
  muted: string;
  target: { kind: "module" | "folder"; id: string } | null;
};

export type InspectorContent = {
  key: string;
  header: Header;
  tabs: { tab: InspectorTab; label: string; active: boolean }[] | null;
  rows: Row[];
};

const NEVER_SHOWN_BASES = new Set(["ABC", "Protocol", "object"]);
const ABSTRACT_BASES = new Set(["ABC", "Protocol"]);
const EXCEPTION = /(Exception|Error)$/;
const PARENT_SEGMENTS = 2;
export const UNUSED_SHOWN = 8;

function findModule(scans: Scan[], id: string) {
  for (const scan of scans) {
    const found = scan.modules.find((module) => module.id === id);

    if (found) {
      return found;
    }
  }

  return undefined;
}

function plural(count: number, what: { singular: string; plural: string }) {
  return count === 1 ? what.singular : what.plural;
}

function classTags(member: ScanMember, edges: ScanEdge[]) {
  const bases = member.bases ?? [];
  const resolved = (base: string, kind: ScanEdge["kind"]) =>
    edges.some(
      (edge) =>
        edge.kind === kind &&
        edge.member === member.name &&
        edge.to_member === base,
    );
  const isResolved = (base: string) =>
    resolved(base, "implements") || resolved(base, "inherits");
  const exceptions = bases.filter(
    (base) => EXCEPTION.test(base) && !isResolved(base),
  );
  const abstract =
    member.kind === "interface" ||
    bases.some((base) => ABSTRACT_BASES.has(base));
  const implemented = bases.filter((base) => resolved(base, "implements"));
  const inherited = bases.filter(
    (base) =>
      !resolved(base, "implements") &&
      (resolved(base, "inherits") ||
        (!exceptions.includes(base) && !NEVER_SHOWN_BASES.has(base))),
  );
  const tags = [...exceptions, ...(abstract ? ["abstract"] : [])];

  return { tags, implemented, inherited };
}

type Placed<T> = { line: number | null; item: T };

function inFileOrder<T>(placed: Placed<T>[]): Placed<T>[] {
  return placed
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const left = a.entry.line ?? Number.POSITIVE_INFINITY;
      const right = b.entry.line ?? Number.POSITIVE_INFINITY;

      return left === right ? a.index - b.index : left - right;
    })
    .map(({ entry }) => entry);
}

function hiddenText(fields: number, methods: number): string {
  const parts = [
    fields > 0 ? `${fields} private ${fields === 1 ? "field" : "fields"}` : "",
    methods > 0
      ? `${methods} private ${methods === 1 ? "method" : "methods"}`
      : "",
  ].filter((part) => part !== "");

  return parts.length === 0 ? "" : `${parts.join(", ")} hidden`;
}

function classCard(
  member: ScanMember,
  edges: ScanEdge[],
  showPrivate: boolean,
): CardRow {
  const label = member.kind === "interface" ? "Interface" : "Class";
  const outline =
    member.bases !== undefined ||
    member.fields !== undefined ||
    member.methods !== undefined;
  const heritage = classTags(member, edges);
  const headOf =
    member.kind === "interface" ? interfaceHeadTokens : classHeadTokens;
  const base: CardRow = {
    kind: "card",
    label,
    line: member.line ?? null,
    head: headOf(member.name, heritage),
    lines: [],
    hidden: "",
    private: !member.exported,
    hover: member.name,
  };

  if (!outline) {
    return {
      ...base,
      lines: [
        {
          line: null,
          tokens: [{ text: "outline not known", role: "plain" }],
          private: false,
        },
      ],
    };
  }

  const fields = (member.fields ?? []).map(
    (field): Placed<CardLine> => ({
      line: field.line,
      item: {
        line: field.line,
        tokens: fieldTokens(field),
        private: field.private === true,
      },
    }),
  );
  const methods = (member.methods ?? []).map(
    (method): Placed<CardLine> => ({
      line: method.line ?? null,
      item: {
        line: method.line ?? null,
        tokens: methodTokens(method),
        private: method.private === true,
      },
    }),
  );
  const all = inFileOrder([...fields, ...methods]).map(({ item }) => item);
  const shown = showPrivate ? all : all.filter((line) => !line.private);
  const hiddenFields = fields.filter(({ item }) => item.private).length;
  const hiddenMethods = methods.filter(({ item }) => item.private).length;

  return {
    ...base,
    lines: shown,
    hidden: showPrivate ? "" : hiddenText(hiddenFields, hiddenMethods),
  };
}

function plainCard(member: ScanMember): CardRow | null {
  const base = {
    kind: "card" as const,
    line: member.line ?? null,
    lines: [],
    hidden: "",
    private: !member.exported,
    hover: member.name,
  };

  if (member.kind === "function") {
    return { ...base, label: "Function", head: functionTokens(member) };
  }

  if (member.kind === "constant") {
    return {
      ...base,
      label: "Constant",
      head: constantTokens(member.name, member.value),
    };
  }

  if (member.kind === "type") {
    return { ...base, label: "Type", head: typeAliasTokens(member.name) };
  }

  return null;
}

function moduleContents(module: string, inputs: InspectorInputs): Row[] {
  const found = findModule(inputs.scans, module);

  if (found?.members === undefined) {
    return [
      {
        kind: "note",
        text: "Not known: this scan has no member outlines for this file.",
      },
    ];
  }

  const edges = inputs.scans.flatMap((scan) =>
    scan.edges.filter((edge) => edge.from === module),
  );
  const shown = found.members.filter(
    (member) => inputs.showPrivate || member.exported,
  );
  const cards = inFileOrder(
    shown.flatMap((member): Placed<CardRow>[] => {
      const card =
        member.kind === "class" || member.kind === "interface"
          ? classCard(member, edges, inputs.showPrivate)
          : plainCard(member);

      return card === null ? [] : [{ line: member.line ?? null, item: card }];
    }),
  ).map(({ item }) => item);

  return [
    { kind: "switch", label: "Show private", on: inputs.showPrivate },
    ...(cards.length === 0 ? [{ kind: "none" } as Row] : cards),
  ];
}

function summaryOf(module: string, inputs: InspectorInputs): string {
  const members = findModule(inputs.scans, module)?.members;

  if (members === undefined) {
    return "";
  }

  const publicOf = (...kinds: string[]) =>
    members.filter(
      (member) => member.exported && kinds.includes(member.kind ?? ""),
    ).length;
  const classes = publicOf("class", "interface");
  const functions = publicOf("function");

  return [
    classes > 0
      ? `${classes} ${plural(classes, { singular: "class", plural: "classes" })}`
      : "",
    functions > 0
      ? `${functions} ${plural(functions, { singular: "function", plural: "functions" })}`
      : "",
  ]
    .filter((part) => part !== "")
    .join(", ");
}

function folderContents(folder: string, inputs: InspectorInputs): Row[] {
  const inside = inputs.modules.filter(
    (id) => id !== folder && under(id, folder),
  );
  const folders = new Map<string, number>();
  const files: string[] = [];

  for (const id of inside) {
    const rest = id.slice(folder.length + 1);
    const slash = rest.indexOf("/");

    if (slash < 0) {
      files.push(id);
    } else {
      const path = `${folder}/${rest.slice(0, slash)}`;

      folders.set(path, (folders.get(path) ?? 0) + 1);
    }
  }

  if (inside.length === 0) {
    return [{ kind: "none" }];
  }

  const filesUnder = (path: string) => inside.filter((id) => under(id, path));

  return [
    ...[...folders]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([path, count]): Row => {
        const ids = filesUnder(path);

        return {
          kind: "module",
          id: path,
          ids,
          label: `${lastSegment(path)}/`,
          state: checkState(ids, inputs.onCanvas),
          bold: ids.some(inputs.onCanvas),
          disc: inputs.disc(path),
          folder: true,
          indent: false,
          chevron: null,
          detail: { text: `${count} ${count === 1 ? "file" : "files"}` },
          title: path,
          follow: null,
          followed: false,
        };
      }),
    ...files
      .sort((a, b) => a.localeCompare(b))
      .map((id): Row => {
        const on = inputs.onCanvas(id);
        const summary = summaryOf(id, inputs);

        return {
          kind: "module",
          id,
          ids: [id],
          label: lastSegment(id),
          state: on ? "checked" : "unchecked",
          bold: on,
          disc: inputs.disc(id),
          folder: false,
          indent: false,
          chevron: null,
          detail: summary === "" ? null : { text: summary },
          title: id,
          follow: null,
          followed: false,
        };
      }),
  ];
}

function pickerFor(
  selection: NonNullable<Selection>,
  direction: Direction,
  inputs: InspectorInputs,
) {
  const source: PickerSource = {
    kind: selection.kind === "folder" ? "folder" : "module",
    id: selection.id,
    direction,
  };

  return {
    picker: createPicker({
      scans: inputs.scans,
      modules: inputs.modules,
      onCanvas: inputs.onCanvas,
      source,
      filter: inputs.filter,
      collapsed: inputs.collapsed,
    }),
  };
}

function pickerRows(
  picker: ReturnType<typeof createPicker>,
  direction: Direction,
  inputs: InspectorInputs,
): Row[] {
  const rows: Row[] = [];

  if (picker.rowCount() === 0) {
    return [...rows, { kind: "none" }];
  }

  const groups = picker.groups();

  if (groups.length === 0) {
    rows.push({ kind: "note", text: "Nothing matches." });
  }

  for (const group of groups) {
    rows.push({
      kind: "module",
      id: group.key,
      ids: group.ids,
      label: group.label,
      state: group.state,
      bold: false,
      disc: inputs.disc(group.key),
      folder: true,
      indent: false,
      chevron: { key: group.key, open: !group.collapsed },
      detail: { text: String(group.count) },
      title: group.label,
      follow: null,
      followed: false,
    });

    if (!group.collapsed) {
      for (const row of group.rows) {
        rows.push({
          kind: "module",
          id: row.id,
          ids: [row.id],
          label: row.label,
          state: row.onCanvas ? "checked" : "unchecked",
          bold: row.onCanvas,
          disc: inputs.disc(row.id),
          folder: false,
          indent: true,
          chevron: null,
          detail:
            row.namesText === ""
              ? null
              : {
                  text: row.namesText,
                  tone: row.private
                    ? "private"
                    : row.inferred
                      ? "inferred"
                      : undefined,
                },
          title: row.id,
          follow: direction,
          followed:
            inputs.followed?.id === row.id &&
            inputs.followed.relation === direction,
        });
      }
    }
  }

  const unused = picker.unused();

  if (unused) {
    const more = unused.length - UNUSED_SHOWN;

    rows.push({
      kind: "note",
      text: `Not used outside: ${unused.slice(0, UNUSED_SHOWN).join(", ")}${
        more > 0 ? ` and ${more} more` : ""
      }`,
    });
  }

  if (picker.missing() > 0) {
    rows.push({ kind: "note", text: `${picker.missing()} not in the scan` });
  }

  return rows;
}

function dependencyRows(
  selection: NonNullable<Selection>,
  figures: Counts,
  inputs: InspectorInputs,
): Row[] {
  const sections: { direction: Direction; label: string; count: number }[] = [
    { direction: "uses", label: "Uses", count: figures.uses },
    { direction: "usedBy", label: "Used by", count: figures.usedBy },
  ];
  const built = sections.map((section) => ({
    ...section,
    ...pickerFor(selection, section.direction, inputs),
  }));
  const total = built.reduce((sum, item) => sum + item.picker.rowCount(), 0);
  const rows: Row[] = [
    {
      kind: "filter",
      value: inputs.filter,
      placeholder: `Filter ${total} modules`,
    },
  ];

  for (const item of built) {
    const key = `dependencies:${item.direction}`;
    const open = !inputs.expanded.has(key);

    rows.push({
      kind: "fold",
      key,
      text: `${item.label} ${item.count}`,
      open,
      top: true,
    });

    if (open) {
      rows.push(...pickerRows(item.picker, item.direction, inputs));
    }
  }

  return rows;
}

function findingRows(findings: Finding[]): Row[] {
  const ordered = [
    ...findings.filter((finding) => finding.severity === "violation"),
    ...findings.filter((finding) => finding.severity === "warning"),
  ];

  return ordered.map((finding) => ({ kind: "finding", ...finding }));
}

function moduleFindings(id: string, inputs: InspectorInputs): Row[] {
  const rows = findingRows(inputs.findings(id));

  if (rows.length > 0) {
    return rows;
  }

  return [
    {
      kind: "note",
      text: inputs.disc(id) === "grey" ? "Not measured" : "No findings",
    },
  ];
}

function foldersGroups(folder: string, inputs: InspectorInputs): Row[] {
  const grey = inputs.disc(folder) === "grey";
  const groups = inputs.modules
    .filter((id) => id !== folder && under(id, folder))
    .map((id) => ({ id, findings: findingRows(inputs.findings(id)) }))
    .filter((group) => group.findings.length > 0)
    .sort((a, b) => a.id.localeCompare(b.id));
  const note = grey ? "Some modules are not measured" : "No findings";

  if (groups.length === 0) {
    return [{ kind: "note", text: note }];
  }

  return [
    ...groups.flatMap((group): Row[] => [
      {
        kind: "group",
        id: group.id,
        disc: inputs.disc(group.id),
        path: group.id.slice(folder.length + 1),
      },
      ...group.findings,
    ]),
    ...(grey ? [{ kind: "note", text: note } as Row] : []),
  ];
}

function countFindings(
  selection: NonNullable<Selection>,
  inputs: InspectorInputs,
) {
  if (selection.kind === "module") {
    return inputs.findings(selection.id).length;
  }

  return inputs.modules
    .filter((id) => id !== selection.id && under(id, selection.id))
    .reduce((sum, id) => sum + inputs.findings(id).length, 0);
}

function parentOf(id: string): string {
  const parts = id.split("/").slice(0, -1).slice(-PARENT_SEGMENTS);

  return parts.length === 0 ? "" : `${parts.join("/")}/`;
}

export function inspectorContent(
  selection: Selection,
  inputs: InspectorInputs,
): InspectorContent {
  if (selection === null) {
    return {
      key: "none",
      header: { disc: null, title: "Inspector", muted: "", target: null },
      tabs: null,
      rows: [
        {
          kind: "note",
          text: "Select a box, a folder or a line to see what is in it.",
        },
      ],
    };
  }

  const key = `${selection.kind}:${selection.id}`;

  if (selection.kind === "edge") {
    const rows: Row[] = !inputs.edgeOnCanvas
      ? [{ kind: "note", text: "Not on the canvas." }]
      : inputs.evidence === null
        ? [{ kind: "note", text: "Loading evidence" }]
        : inputs.evidence.map((section) => ({ kind: "evidence", section }));

    return {
      key,
      header: { disc: null, title: "Edge", muted: "", target: null },
      tabs: null,
      rows,
    };
  }

  const count = countFindings(selection, inputs);
  const figures = inputs.counts(selection);
  const tabs = [
    {
      tab: "contents" as const,
      label: "Contents",
      active: inputs.tab === "contents",
    },
    {
      tab: "findings" as const,
      label: count > 0 ? `Findings ${count}` : "Findings",
      active: inputs.tab === "findings",
    },
    {
      tab: "dependencies" as const,
      label: `Dependencies ${figures.uses + figures.usedBy}`,
      active: inputs.tab === "dependencies",
    },
  ];
  const contents = inputs.tab === "contents";
  const listed = inputs.tab === "dependencies";

  if (selection.kind === "module") {
    return {
      key,
      header: {
        disc: inputs.disc(selection.id),
        title: lastSegment(selection.id),
        muted: parentOf(selection.id),
        target: { kind: "module", id: selection.id },
      },
      tabs,
      rows: listed
        ? dependencyRows(selection, figures, inputs)
        : contents
          ? moduleContents(selection.id, inputs)
          : moduleFindings(selection.id, inputs),
    };
  }

  const known = inputs.modules.filter(
    (id) => id !== selection.id && under(id, selection.id),
  ).length;

  return {
    key,
    header: {
      disc: inputs.disc(selection.id),
      title: `${lastSegment(selection.id)}/`,
      muted: `${known} files`,
      target: { kind: "folder", id: selection.id },
    },
    tabs,
    rows: listed
      ? dependencyRows(selection, figures, inputs)
      : contents
        ? folderContents(selection.id, inputs)
        : foldersGroups(selection.id, inputs),
  };
}

export function emphasisedLines(
  module: string,
  name: string,
  lines: Pick<Line, "id" | "edges">[],
): Set<string> {
  const carries = (edge: ScanEdge) =>
    edge.to === module &&
    (edge.names?.includes(name) === true ||
      edge.to_member === name ||
      edge.inferred?.class === name);

  return new Set(
    lines.filter((line) => line.edges.some(carries)).map((line) => line.id),
  );
}

export function followableRows(rows: Row[]): Followed[] {
  return rows.flatMap((row) =>
    row.kind === "module" && row.follow !== null
      ? [{ id: row.id, relation: row.follow }]
      : [],
  );
}
