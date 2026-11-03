import {
  fieldTokens,
  memberHeadTokens,
  methodTokens,
  type Scan,
  type ScanEdge,
  type ScanMember,
  type Token,
} from "recognizer";
import { type Counts, type Line, lastSegment, under } from "./canvas-graph";
import type { Selection } from "./canvas-state";
import type { EvidenceSection } from "./edge-evidence";
import type { FindingRow } from "./findings-order";
import type { Compaction } from "./folder-compaction";
import type { Disc, Finding } from "./health";
import { barTitle, type Tone, tone, valueLabel } from "./metric-bars";
import type { MetricDescriptor } from "./overlay-model";
import { createPicker, type PickerSource } from "./picker-model";
import type { ResponsibilityRow } from "./responsibility-model";
import { type CheckState, checkState } from "./row-model";

export type InspectorTab = "contents" | "findings" | "dependencies";

export type InspectorInputs = {
  scans: Scan[];
  modules: string[];
  compaction: Compaction;
  disc: (id: string) => Disc;
  findings: (id: string) => Finding[];
  findingRows: (id: string) => FindingRow[];
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
  responsibility: (id: string) => ResponsibilityRow;
  metrics: readonly MetricDescriptor[];
};

export type Direction = "uses" | "usedBy";

export type Followed = { id: string; relation: Direction };

export type CardLabel =
  | "Class"
  | "Interface"
  | "Type"
  | "Enum"
  | "Function"
  | "Constant";

export type CardLine = {
  line: number | null;
  tokens: Token[];
  private: boolean;
};

export type MetricCell = { text: string; tone: Tone | null; title: string };

export type MetricTable = {
  head: { text: string; title: string }[];
  rows: { name: string | null; cells: MetricCell[] }[];
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
  table: MetricTable | null;
};

export type SwitchRow = { kind: "switch"; label: "Show private"; on: boolean };

export type ResponsibilityLineRow = {
  kind: "responsibility";
  id: string;
} & ResponsibilityRow;

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
  | { kind: "finding"; row: FindingRow }
  | { kind: "evidence"; section: EvidenceSection };

export type Header = {
  disc: Disc | null;
  title: string;
  muted: string;
  target: { kind: "module" | "folder"; id: string } | null;
  responsibility: ResponsibilityLineRow | null;
};

export type InspectorContent = {
  key: string;
  header: Header;
  tabs: { tab: InspectorTab; label: string; active: boolean }[] | null;
  rows: Row[];
};

const PLAIN_LABELS: Record<string, CardLabel> = {
  function: "Function",
  constant: "Constant",
  type: "Type",
  enum: "Enum",
};
const SHORT_METRIC: Record<string, string> = {
  complexity: "cc",
  coverage: "cov",
  crap: "CRAP",
  mutation_score: "mut",
  mutation_survived: "surv",
};
const SHORT_MUTATION: Record<string, string> = {
  score: "mut",
  survived: "surv",
};
const MUTATION_OVERLAYS = new Set(["mutate", "mutation"]);
const PARENT_SEGMENTS = 2;

function shortMetric(metric: MetricDescriptor): string {
  const mutation = MUTATION_OVERLAYS.has(metric.overlay)
    ? SHORT_MUTATION[metric.label]
    : undefined;

  return mutation ?? SHORT_METRIC[metric.label] ?? metric.label;
}

function cellOf(metric: MetricDescriptor, memberId: string): MetricCell {
  const value = metric.values[memberId];

  if (value === undefined) {
    return {
      text: "-",
      tone: null,
      title: barTitle(metric, null),
    };
  }

  return {
    text: valueLabel(metric, value),
    tone: tone(metric, value),
    title: barTitle(metric, { value, member: null }),
  };
}

function metricTable(
  metrics: readonly MetricDescriptor[],
  module: string,
  members: { name: string | null; id: string }[],
): MetricTable | null {
  const columns = metrics.filter((metric) => metric.granularity === "member");

  if (columns.length === 0 || members.length === 0) {
    return null;
  }

  return {
    head: columns.map((metric) => ({
      text: shortMetric(metric),
      title: metric.label,
    })),
    rows: members.map((member) => ({
      name: member.name,
      cells: columns.map((metric) => cellOf(metric, `${module}::${member.id}`)),
    })),
  };
}
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
  module: string,
  metrics: readonly MetricDescriptor[],
): CardRow {
  const label = member.kind === "interface" ? "Interface" : "Class";
  const outline =
    member.bases !== undefined ||
    member.fields !== undefined ||
    member.methods !== undefined;
  const base: CardRow = {
    kind: "card",
    label,
    line: member.line ?? null,
    head: memberHeadTokens(member, edges) ?? [],
    lines: [],
    hidden: "",
    private: !member.exported,
    hover: member.name,
    table: null,
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
    table: metricTable(
      metrics,
      module,
      (member.methods ?? [])
        .filter((method) => showPrivate || method.private !== true)
        .map((method) => ({
          name: method.name,
          id: `${member.name}.${method.name}`,
        })),
    ),
  };
}

function plainCard(
  member: ScanMember,
  module: string,
  metrics: readonly MetricDescriptor[],
): CardRow | null {
  const head = memberHeadTokens(member, []);
  const label = PLAIN_LABELS[member.kind ?? ""];

  if (head === null || label === undefined) {
    return null;
  }

  return {
    kind: "card",
    label,
    line: member.line ?? null,
    head,
    lines: [],
    hidden: "",
    private: !member.exported,
    hover: member.name,
    table:
      member.kind === "function"
        ? metricTable(metrics, module, [{ name: null, id: member.name }])
        : null,
  };
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
          ? classCard(member, edges, inputs.showPrivate, module, inputs.metrics)
          : plainCard(member, module, inputs.metrics);

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
      const path = inputs.compaction.canonical(
        `${folder}/${rest.slice(0, slash)}`,
      );

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
          label: `${inputs.compaction.label(path)}/`,
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
      compaction: inputs.compaction,
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
          detail: null,
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

function findingRows(rows: FindingRow[]): Row[] {
  const ordered = [
    ...rows.filter((row) => row.severity === "violation"),
    ...rows.filter((row) => row.severity === "warning"),
  ];

  return ordered.map((row) => ({ kind: "finding", row }));
}

function moduleFindings(id: string, inputs: InspectorInputs): Row[] {
  const rows = findingRows(inputs.findingRows(id));

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
    .map((id) => ({ id, findings: findingRows(inputs.findingRows(id)) }))
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

type FindingInputs = Pick<InspectorInputs, "findings" | "modules">;

function findingsUnder(
  selection: NonNullable<Selection>,
  inputs: FindingInputs,
): Finding[] {
  if (selection.kind === "module") {
    return inputs.findings(selection.id);
  }

  return inputs.modules
    .filter((id) => id !== selection.id && under(id, selection.id))
    .flatMap((id) => inputs.findings(id));
}

export function countFindings(
  selection: NonNullable<Selection>,
  inputs: FindingInputs,
) {
  return findingsUnder(selection, inputs).length;
}

export function findingsTone(
  selection: NonNullable<Selection>,
  inputs: FindingInputs,
): { count: number; tone: "red" | "amber" } | null {
  const found = findingsUnder(selection, inputs);

  if (found.length === 0) {
    return null;
  }

  return {
    count: found.length,
    tone: found.some((one) => one.severity === "violation") ? "red" : "amber",
  };
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
      header: {
        disc: null,
        title: "Inspector",
        muted: "",
        target: null,
        responsibility: null,
      },
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
      header: {
        disc: null,
        title: "Edge",
        muted: "",
        target: null,
        responsibility: null,
      },
      tabs: null,
      rows,
    };
  }

  const count = countFindings(selection, inputs);
  const figures = inputs.counts(selection);
  const tabs: { tab: InspectorTab; label: string; active: boolean }[] = [
    {
      tab: "contents" as const,
      label: "Contents",
      active: inputs.tab === "contents",
    },
    {
      tab: "dependencies" as const,
      label: `Dependencies ${figures.uses + figures.usedBy}`,
      active: inputs.tab === "dependencies",
    },
    {
      tab: "findings" as const,
      label: count > 0 ? `Findings ${count}` : "Findings",
      active: inputs.tab === "findings",
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
        responsibility: {
          kind: "responsibility",
          id: selection.id,
          ...inputs.responsibility(selection.id),
        },
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
      title: `${inputs.compaction.label(selection.id)}/`,
      muted:
        parentOf(selection.id) === ""
          ? `${known} files`
          : `${known} files · ${parentOf(selection.id)}`,
      target: { kind: "folder", id: selection.id },
      responsibility: null,
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
