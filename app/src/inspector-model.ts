import {
  fieldTokens,
  folderOf,
  memberHeadTokens,
  methodTokens,
  type Scan,
  type ScanEdge,
  type ScanMember,
  type Token,
  type ViewProposedChange,
} from "recognizer";
import { type Counts, type Line, lastSegment, under } from "./canvas-graph";
import type { Selection } from "./canvas-state";
import { type FindingGroupModel, groupsOf } from "./findings-groups";
import type { FindingRow } from "./findings-order";
import type { Compaction } from "./folder-compaction";
import {
  barPercent,
  functionLength,
  type LengthBand,
  lengthBand,
  lengthText,
} from "./function-length";
import type { FunctionLimits } from "./function-limits";
import type { Disc, Finding } from "./health";
import {
  type MemberMark,
  type MemberMarkWord,
  memberMark,
} from "./member-mark";
import { barTitle, type Tone, tone, valueLabel } from "./metric-bars";
import { descriptionOf } from "./module-tip";
import type { MetricDescriptor } from "./overlay-model";
import { createPicker, type PickerSource } from "./picker-model";
import { PROPOSED_WORDS } from "./plan-overlay";
import type { ResponsibilityRow } from "./responsibility-model";
import { type CheckState, checkState } from "./row-model";
import { fileLabel } from "./tree-model";

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
  counts: (selection: NonNullable<Selection>) => Counts;
  filter: string;
  followed: Followed | null;
  responsibility: (id: string) => ResponsibilityRow;
  metrics: readonly MetricDescriptor[];
  metricsOn: boolean;
  limits: FunctionLimits;
  proposed?: (id: string) => ViewProposedChange | null;
  members?: InspectorMembers;
};

export type InspectorMembers = {
  mark: (module: string, key: string) => MemberMarkWord | null;
  planned: (module: string) => string[];
  start: (module: string) => ScanMember[] | null;
  note: (module: string) => string | null;
};

export type MemberLook = "removed" | "planned";

export type Direction = "uses" | "usedBy";

export type Followed = { id: string; relation: Direction };

export type CardLabel =
  | "Member"
  | "Class"
  | "Interface"
  | "Type"
  | "Enum"
  | "Function"
  | "Constant";

export type CardSize = { text: string; band: LengthBand; width: number };

export type CardLine = {
  line: number | null;
  tokens: Token[];
  private: boolean;
  size: CardSize | null;
  mark?: MemberMark;
  look?: MemberLook;
};

export type MetricCell = { text: string; tone: Tone | null; title: string };

export type MetricTable = {
  head: { text: string; title: string }[];
  rows: { name: string | null; cells: MetricCell[] }[];
};

export type FunctionMetricCell = {
  name: string;
  text: string;
  tone: "amber" | "red" | null;
  title: string;
};

export type CardRow = {
  kind: "card";
  label: CardLabel;
  module: string;
  line: number | null;
  showsLine: boolean;
  size: CardSize | null;
  metricsRow: FunctionMetricCell[] | null;
  head: Token[];
  lines: CardLine[];
  hidden: string;
  private: boolean;
  hover: string;
  table: MetricTable | null;
  mark?: MemberMark;
  look?: MemberLook;
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
  | { kind: "heading"; text: string }
  | {
      kind: "panel";
      direction: Direction;
      label: string;
      count: number;
      caption: string;
      rows: Row[];
    }
  | {
      kind: "folder-label";
      key: string;
      label: string;
      own: boolean;
      count: number;
      ids: string[];
      allOn: boolean;
    }
  | { kind: "legend"; text: string }
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
      discFirst?: boolean;
      chevron: { key: string; open: boolean } | null;
      detail: { text: string; tone?: "private" | "inferred" } | null;
      title: string;
      description: string | null;
      follow: Direction | null;
      followed: boolean;
    }
  | {
      kind: "finding-group";
      key: string;
      group: FindingGroupModel;
      open: boolean;
    };

export type Header = {
  disc: Disc | null;
  title: string;
  muted: string;
  target: { kind: "module" | "folder"; id: string } | null;
  responsibility: ResponsibilityLineRow | null;
  proposed?: string;
  from?: string;
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
type Naming = { short: string; full: string };

const METRIC_NAMES: Record<string, Naming> = {
  complexity: { short: "cc", full: "Cyclomatic complexity" },
  coverage: { short: "cov", full: "Coverage" },
  crap: { short: "CRAP", full: "C.R.A.P. (Change Risk Anti-Patterns) score" },
  mutation_score: { short: "mut", full: "Mutation score" },
  mutation_survived: { short: "surv", full: "Survived mutants" },
  killed: { short: "kill", full: "Killed mutants" },
  uncovered: { short: "unc", full: "Uncovered" },
};
const MUTATION_NAMES: Record<string, Naming> = {
  score: METRIC_NAMES.mutation_score as Naming,
  survived: METRIC_NAMES.mutation_survived as Naming,
};
const MUTATION_OVERLAYS = new Set(["mutate", "mutation"]);
const PARENT_SEGMENTS = 2;

function naming(metric: MetricDescriptor): Naming | undefined {
  const mutation = MUTATION_OVERLAYS.has(metric.overlay)
    ? MUTATION_NAMES[metric.label]
    : undefined;

  return mutation ?? METRIC_NAMES[metric.label];
}

export function fullMetricName(metric: MetricDescriptor): string {
  return naming(metric)?.full ?? metric.label;
}

export function shortMetric(metric: MetricDescriptor): string {
  return naming(metric)?.short ?? metric.label;
}

function cellOf(metric: MetricDescriptor, memberId: string): MetricCell {
  const value = metric.values[memberId];

  if (value === undefined) {
    return {
      text: "-",
      tone: null,
      title: barTitle(metric, null, fullMetricName(metric)),
    };
  }

  return {
    text: valueLabel(metric, value),
    tone: tone(metric, value),
    title: barTitle(metric, { value, member: null }, fullMetricName(metric)),
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
      title: fullMetricName(metric),
    })),
    rows: members.map((member) => ({
      name: member.name,
      cells: columns.map((metric) => cellOf(metric, `${module}::${member.id}`)),
    })),
  };
}
export const UNUSED_SHOWN = 8;

function proposedHeader(
  proposed: ViewProposedChange | null,
): Pick<Header, "proposed" | "from"> {
  if (proposed === null) {
    return {};
  }

  return {
    proposed: `Proposed change: ${PROPOSED_WORDS[proposed.kind]}`,
    ...(proposed.from === undefined ? {} : { from: proposed.from }),
  };
}

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

function sizeOf(
  line: number | null | undefined,
  endLine: number | null | undefined,
  largest: number,
): CardSize | null {
  const lines = functionLength(line, endLine);

  if (lines === null) {
    return null;
  }

  return {
    text: lengthText(lines),
    band: lengthBand(lines),
    width: barPercent(lines, largest),
  };
}

function lengthsOf(members: readonly ScanMember[]): number[] {
  return members.flatMap((member) => {
    if (member.kind === "function") {
      const lines = functionLength(member.line, member.end_line);

      return lines === null ? [] : [lines];
    }

    return (member.methods ?? []).flatMap((method) => {
      const lines = functionLength(method.line, method.end_line);

      return lines === null ? [] : [lines];
    });
  });
}

type MemberContext = {
  module: string;
  mark: (module: string, key: string) => MemberMarkWord | null;
  start: ScanMember[] | null;
};

function markOf(
  context: MemberContext | null,
  key: string,
): { mark: MemberMark; look?: MemberLook } | Record<string, never> {
  const word = context?.mark(context.module, key) ?? null;

  if (word === null) {
    return {};
  }

  return {
    mark: memberMark(word),
    ...(word === "removed" ? { look: "removed" as const } : {}),
  };
}

function insertRemoved<T>(
  existing: { key: string | null; item: T }[],
  start: { key: string; line: number | null }[],
  removed: Map<string, T>,
): T[] {
  const result = [...existing];
  const ordered = inFileOrder(
    start.map((entry) => ({ line: entry.line, item: entry.key })),
  ).map(({ item }) => item);

  ordered.forEach((key, at) => {
    const row = removed.get(key);

    if (row === undefined) {
      return;
    }

    let after = -1;

    for (let back = at - 1; back >= 0 && after < 0; back -= 1) {
      after = result.findIndex((entry) => entry.key === ordered[back]);
    }

    result.splice(after + 1, 0, { key, item: row });
  });

  return result.map((entry) => entry.item);
}

function classCard(
  member: ScanMember,
  edges: ScanEdge[],
  showPrivate: boolean,
  module: string,
  metrics: readonly MetricDescriptor[],
  largest: number,
  context: MemberContext | null = null,
): CardRow {
  const label = member.kind === "interface" ? "Interface" : "Class";
  const outline =
    member.bases !== undefined ||
    member.fields !== undefined ||
    member.methods !== undefined;
  const base: CardRow = {
    kind: "card",
    label,
    module,
    line: member.line ?? null,
    showsLine: true,
    size: null,
    metricsRow: null,
    head: memberHeadTokens(member, edges) ?? [],
    lines: [],
    hidden: "",
    private: !member.exported,
    hover: member.name,
    table: null,
    ...markOf(context, member.name),
  };

  if (!outline) {
    return {
      ...base,
      lines: [
        {
          line: null,
          tokens: [{ text: "outline not known", role: "plain" }],
          private: false,
          size: null,
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
        size: null,
      },
    }),
  );
  const methods = (member.methods ?? []).map(
    (method): Placed<CardLine> & { key: string } => ({
      line: method.line ?? null,
      key: `${member.name}.${method.name}`,
      item: {
        line: method.line ?? null,
        tokens: methodTokens(method),
        private: method.private === true,
        size: sizeOf(method.line, method.end_line, largest),
        ...markOf(context, `${member.name}.${method.name}`),
      },
    }),
  );
  const keyed = new Map(methods.map((method) => [method.item, method.key]));
  const all = inFileOrder([...fields, ...methods]).map(({ item }) => item);
  const visible = showPrivate ? all : all.filter((line) => !line.private);
  const shown = withRemovedMethods(member, visible, keyed, context, largest);
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

function withRemovedMethods(
  member: ScanMember,
  visible: CardLine[],
  keyed: Map<CardLine, string>,
  context: MemberContext | null,
  largest: number,
): CardLine[] {
  const before = context?.start?.find((entry) => entry.name === member.name);

  if (context === null || before === undefined) {
    return visible;
  }

  const removed = new Map<string, CardLine>();
  const starts: { key: string; line: number | null }[] = [];

  for (const method of before.methods ?? []) {
    const key = `${member.name}.${method.name}`;

    starts.push({ key, line: method.line ?? null });

    if (context.mark(context.module, key) === "removed") {
      removed.set(key, {
        line: null,
        tokens: methodTokens(method),
        private: false,
        size: sizeOf(null, null, largest),
        mark: memberMark("removed"),
        look: "removed",
      });
    }
  }

  if (removed.size === 0) {
    return visible;
  }

  return insertRemoved(
    visible.map((item) => ({ key: keyed.get(item) ?? null, item })),
    starts,
    removed,
  );
}

function metricOf(
  metrics: readonly MetricDescriptor[],
  label: string,
): MetricDescriptor | undefined {
  return metrics.find(
    (metric) => metric.label === label && metric.granularity === "member",
  );
}

function functionMetricsRow(
  member: ScanMember,
  module: string,
  metrics: readonly MetricDescriptor[],
  limits: FunctionLimits,
): FunctionMetricCell[] {
  const cell = (
    label: string,
    short: string,
    warn: (value: number) => "amber" | "red" | null,
  ): FunctionMetricCell => {
    const metric = metricOf(metrics, label);
    const value = metric?.values[`${module}::${member.name}`];
    const name = metric === undefined ? label : fullMetricName(metric);

    if (metric === undefined || typeof value !== "number") {
      return {
        name: short,
        text: "-",
        tone: null,
        title: `${name}: not measured`,
      };
    }

    return {
      name: short,
      text: valueLabel(metric, value),
      tone: warn(value),
      title: barTitle(metric, { value, member: null }, name),
    };
  };

  return [
    cell("complexity", "cc", (value) =>
      limits.complexityAbove !== null && value > limits.complexityAbove
        ? "amber"
        : null,
    ),
    cell("crap", "CRAP", (value) => (value >= limits.crapAt ? "red" : null)),
    cell("coverage", "cov", (value) =>
      limits.coverageBelow !== null && value < limits.coverageBelow
        ? "amber"
        : null,
    ),
  ];
}

function plainCard(
  member: ScanMember,
  module: string,
  largest: number,
  inputs: InspectorInputs,
  context: MemberContext | null = null,
): CardRow | null {
  const head = memberHeadTokens(member, []);
  const label = PLAIN_LABELS[member.kind ?? ""];

  if (head === null || label === undefined) {
    return null;
  }

  const isFunction = member.kind === "function";

  return {
    kind: "card",
    label,
    module,
    line: member.line ?? null,
    showsLine: !isFunction,
    size: isFunction ? sizeOf(member.line, member.end_line, largest) : null,
    metricsRow:
      isFunction && inputs.metricsOn
        ? functionMetricsRow(member, module, inputs.metrics, inputs.limits)
        : null,
    head,
    lines: [],
    hidden: "",
    private: !member.exported,
    hover: member.name,
    table: null,
    ...markOf(context, member.name),
  };
}

function removedCard(card: CardRow): CardRow {
  return {
    ...card,
    line: null,
    showsLine: false,
    size: null,
    metricsRow: null,
    table: null,
    lines: card.lines.map((line) => ({ ...line, line: null, size: null })),
    mark: memberMark("removed"),
    look: "removed",
  };
}

function plannedLine(name: string): CardLine {
  return {
    line: null,
    tokens: [{ text: name, role: "name" }],
    private: false,
    size: null,
    mark: memberMark("new"),
    look: "planned",
  };
}

function plannedCards(
  keys: string[],
  cards: { key: string | null; item: CardRow }[],
  module: string,
): CardRow[] {
  const added: { key: string; card: CardRow }[] = [];
  const newCard = (name: string): CardRow => ({
    kind: "card",
    label: "Member",
    module,
    line: null,
    showsLine: false,
    size: null,
    metricsRow: null,
    head: [{ text: name, role: "name" }],
    lines: [],
    hidden: "",
    private: false,
    hover: name,
    table: null,
    mark: memberMark("new"),
    look: "planned",
  });

  for (const key of keys.filter((k) => !k.includes("."))) {
    if (!cards.some((entry) => entry.key === key)) {
      added.push({ key, card: newCard(key) });
    }
  }

  for (const key of keys.filter((k) => k.includes("."))) {
    const dot = key.indexOf(".");
    const owner = key.slice(0, dot);
    const method = key.slice(dot + 1);
    const host =
      cards.find((entry) => entry.key === owner)?.item ??
      added.find((entry) => entry.key === owner)?.card;

    if (host !== undefined) {
      host.lines = [...host.lines, plannedLine(method)];
    } else {
      added.push({ key, card: newCard(key) });
    }
  }

  return added.map((entry) => entry.card);
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
  const largest = Math.max(0, ...lengthsOf(found.members));
  const members = inputs.members;
  const context: MemberContext | null =
    members === undefined
      ? null
      : {
          module,
          mark: members.mark,
          start: members.start(module),
        };
  const build = (member: ScanMember, using: MemberContext | null) =>
    member.kind === "class" || member.kind === "interface"
      ? classCard(
          member,
          edges,
          inputs.showPrivate,
          module,
          inputs.metrics,
          largest,
          using,
        )
      : plainCard(member, module, largest, inputs, using);
  const placed = inFileOrder(
    shown.flatMap((member): Placed<{ key: string | null; item: CardRow }>[] => {
      const card = build(member, context);

      return card === null
        ? []
        : [
            {
              line: member.line ?? null,
              item: { key: member.name, item: card },
            },
          ];
    }),
  ).map(({ item }) => item);
  const survivors = new Set(found.members.map((member) => member.name));
  const removed = new Map<string, CardRow>();
  const starts: { key: string; line: number | null }[] = [];

  for (const member of context?.start ?? []) {
    starts.push({ key: member.name, line: member.line ?? null });

    if (
      !survivors.has(member.name) &&
      context?.mark(module, member.name) === "removed" &&
      (inputs.showPrivate || member.exported)
    ) {
      const card = build(member, null);

      if (card !== null) {
        removed.set(member.name, removedCard(card));
      }
    }
  }

  const ordered =
    removed.size === 0
      ? placed.map((entry) => entry.item)
      : insertRemoved(placed, starts, removed);
  const planned = plannedCards(members?.planned(module) ?? [], placed, module);
  const cards = [...ordered, ...planned];
  const note = members?.note(module) ?? null;

  return [
    { kind: "switch", label: "Show private", on: inputs.showPrivate },
    ...(note === null ? [] : [{ kind: "note", text: note } as Row]),
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
          description: null,
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
          description: descriptionOf(inputs.responsibility(id).state),
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
      collapsed: new Set(),
    }),
  };
}

export function dependencyLabels(
  keys: string[],
  own: string,
): Map<string, string> {
  const all = [...new Set([...keys, own])];
  const first = (key: string) => key.split("/")[0];
  const shared =
    all.every((key) => key !== "") &&
    all.every((key) => first(key) === first(all[0]));
  const dropped = shared ? first(all[0]) : null;
  const labels = new Map<string, string>();

  for (const key of all) {
    if (key === own) {
      labels.set(key, "this folder");
    } else if (key === "" || key === dropped) {
      labels.set(key, "./");
    } else if (dropped !== null) {
      labels.set(key, `${key.slice(dropped.length + 1)}/`);
    } else {
      labels.set(key, `${key}/`);
    }
  }

  return labels;
}

function pickerRows(
  picker: ReturnType<typeof createPicker>,
  direction: Direction,
  inputs: InspectorInputs,
  labels: Map<string, string>,
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
      kind: "folder-label",
      key: group.key,
      label: labels.get(group.key) ?? group.label,
      own: labels.get(group.key) === "this folder",
      count: group.count,
      ids: group.ids,
      allOn: group.state === "checked",
    });

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
        discFirst: true,
        chevron: null,
        detail: null,
        title: row.id,
        description: descriptionOf(inputs.responsibility(row.id).state),
        follow: direction,
        followed:
          inputs.followed?.id === row.id &&
          inputs.followed.relation === direction,
      });
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
  const own =
    selection.kind === "folder" ? selection.id : folderOf(selection.id);
  const labels = dependencyLabels(
    built.flatMap((item) => item.picker.groups().map((group) => group.key)),
    own,
  );
  const name =
    selection.kind === "folder"
      ? `${inputs.compaction.label(selection.id)}/`
      : fileLabel(selection.id);
  const rows: Row[] = [
    {
      kind: "filter",
      value: inputs.filter,
      placeholder: `Filter ${total} modules`,
    },
  ];

  for (const item of built) {
    rows.push({
      kind: "panel",
      direction: item.direction,
      label: item.label,
      count: item.count,
      caption:
        item.direction === "uses"
          ? `${name} imports these`
          : `these import ${name}`,
      rows: pickerRows(item.picker, item.direction, inputs, labels),
    });
  }

  rows.push({
    kind: "legend",
    text: "on the canvas · the eye shows or hides · the name centres the canvas on it",
  });

  return rows;
}

function groupRows(rows: FindingRow[], inputs: InspectorInputs): Row[] {
  return groupsOf(rows).map((group) => {
    const key = `findings:${group.key}`;

    return {
      kind: "finding-group",
      key,
      group,
      open: inputs.expanded.has(key),
    };
  });
}

function moduleFindings(id: string, inputs: InspectorInputs): Row[] {
  const groups = groupRows(inputs.findingRows(id), inputs);

  if (groups.length > 0) {
    return groups;
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
  const rows = inputs.modules
    .filter((id) => id !== folder && under(id, folder))
    .sort((a, b) => a.localeCompare(b))
    .flatMap((id) => inputs.findingRows(id))
    .filter((row, at, all) => all.findIndex((one) => one.id === row.id) === at);
  const groups = groupRows(rows, inputs);
  const note = grey ? "Some modules are not measured" : "No findings";

  if (groups.length === 0) {
    return [{ kind: "note", text: note }];
  }

  return [...groups, ...(grey ? [{ kind: "note", text: note } as Row] : [])];
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
  if (selection === null || selection.kind === "edge") {
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
        ...proposedHeader(inputs.proposed?.(selection.id) ?? null),
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

export function flatRows(rows: Row[]): Row[] {
  return rows.flatMap((row) => (row.kind === "panel" ? row.rows : [row]));
}

export function followableRows(rows: Row[]): Followed[] {
  return flatRows(rows).flatMap((row) =>
    row.kind === "module" && row.follow !== null
      ? [{ id: row.id, relation: row.follow }]
      : [],
  );
}
