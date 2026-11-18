import {
  type PlannedChange,
  type PolicyCard,
  quoteCommand,
  type SetupMark,
  type Survey,
  type SurveyRunner,
  type SurveySuite,
} from "recognizer";
import { button, el } from "./dom";
import {
  acceptedCards,
  canNext,
  changesOf,
  createSetupController,
  currentKey,
  droppedOf,
  isSkipped,
  pluginChecks,
  type Row,
  SETUP_STEPS,
  type SetupController,
  type SetupState,
  sharedBy,
  testsWanted,
  undecidedCards,
  type WizardState,
} from "./setup-model";
import type { DoctorRead, SetupPort } from "./setup-port";
import { elapsedText, type LoadingState, type Timed } from "./setup-progress";

export type SetupModalDeps = {
  port: SetupPort;
  reloadSensors?: () => Promise<void> | void;
  scanAfterApply?: () => void;
  onDoctor?: (read: DoctorRead) => void;
  onClose?: () => void;
  now?: () => number;
};

export type SetupModal = {
  element: HTMLElement;
  ready: Promise<void>;
  controller: SetupController;
  close(): void;
};

const LANGUAGES: Record<string, string> = {
  typescript: "TypeScript",
  rust: "Rust",
  python: "Python",
  kotlin: "Kotlin",
  csharp: "C#",
};

const LIMIT_SENTENCES: Record<string, [string, string]> = {
  long_function: ["functions with more than ", " lines"],
  complexity: [
    "functions with more than ",
    " paths through them (cyclomatic complexity)",
  ],
  pair_min_lines: [
    "functions that repeat each other, when both are ",
    " or more lines",
  ],
};

const SVG = "http://www.w3.org/2000/svg";

type IconKind = "spinner" | "tick" | "circle";

function icon(kind: IconKind): SVGElement {
  const svg = document.createElementNS(SVG, "svg");
  const shape = (name: string, attributes: Record<string, string>) => {
    const node = document.createElementNS(SVG, name);

    for (const [key, value] of Object.entries(attributes)) {
      node.setAttribute(key, value);
    }

    svg.append(node);
  };

  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", `sw-icon sw-icon-${kind}`);

  if (kind === "spinner") {
    shape("circle", { cx: "8", cy: "8", r: "6", opacity: "0.25" });
    shape("path", { d: "M14 8a6 6 0 0 0-6-6" });
  } else if (kind === "tick") {
    shape("path", { d: "M3.5 8.5l3 3 6-7" });
  } else {
    shape("circle", { cx: "8", cy: "8", r: "5.5" });
  }

  return svg;
}

const STATE_ICON: Record<string, IconKind> = {
  waiting: "circle",
  running: "spinner",
  done: "tick",
};

const GLYPH: Record<string, string> = {
  failed: "✕",
  undone: "↺",
};

function languageName(name: string): string {
  return LANGUAGES[name] ?? name;
}

function folderText(folders: { path: string; files: number }[]): string {
  return folders.map((one) => `${one.path} (${one.files})`).join(", ");
}

const MARK_TEXT: Record<SetupMark, string> = {
  "set-up": "Set up",
  new: "New",
  gone: "Gone",
};

const UPGRADE_CODES = ["config-retired", "config-empty", "policy-retired"];

function markTag(mark: SetupMark | null): HTMLElement[] {
  return mark === null
    ? []
    : [el("span", `sw-mark sw-mark-${mark}`, MARK_TEXT[mark])];
}

function changedSince(survey: Survey): string[] {
  const named = (items: string[]) => items.join(", ");
  const languages = survey.files ?? [];
  const lines: string[] = [];
  const fresh = languages.filter((one) => one.mark === "new");
  const gone = languages.filter((one) => one.mark === "gone");
  const runners = survey.runners.map((one) => `${one.name} (${one.directory})`);
  const suites = survey.suites
    .filter((one) => one.mark === "gone")
    .map((one) => `${one.name} (${one.directory})`);
  const moved = survey.fixes.filter((one) =>
    UPGRADE_CODES.includes(one.code),
  ).length;

  if (fresh.length > 0) {
    lines.push(
      `New languages: ${named(fresh.map((one) => languageName(one.language)))}.`,
    );
  }

  if (runners.length > 0) {
    lines.push(`New test runners: ${named(runners)}.`);
  }

  if (gone.length > 0) {
    lines.push(
      `Languages with no files now: ${named(gone.map((one) => languageName(one.language)))}.`,
    );
  }

  if (suites.length > 0) {
    lines.push(`Test suites whose folder is gone: ${named(suites)}.`);
  }

  if (moved > 0) {
    lines.push(`${moved} setting${moved === 1 ? "" : "s"} an upgrade moved.`);
  }

  return lines;
}

function commandText(change: PlannedChange): string {
  return change.steps.map((one) => quoteCommand(one.argv)).join("\n");
}

function cardHead(card: PolicyCard): string {
  if (card.kind === "ignore") {
    return "Leave these files out of the dependency checks";
  }

  if (card.kind === "entry") {
    return "Treat these files as entry points";
  }

  const from = card.from.join(", ");
  const to = card.to.join(" or ");

  return card.both
    ? `Files in ${from} and ${to} must not import each other`
    : `Files in ${from} must not import from ${to}`;
}

export function openSetupModal(deps: SetupModalDeps): SetupModal {
  const controller = createSetupController({
    port: deps.port,
    ...(deps.reloadSensors === undefined
      ? {}
      : { reloadSensors: deps.reloadSensors }),
    ...(deps.scanAfterApply === undefined
      ? {}
      : { scanAfterApply: deps.scanAfterApply }),
    ...(deps.onDoctor === undefined ? {} : { onDoctor: deps.onDoctor }),
    ...(deps.now === undefined ? {} : { now: deps.now }),
  });
  const scrim = el("div", "settings-scrim");
  const modal = el("div", "settings-modal setup-modal");
  const head = el("div", "sw-head");
  const title = el("h1", "sw-title", "Set up");
  const where = el("p", "sw-where");
  const steps = el("div", "sw-steps");
  const body = el("div", "sw-body");
  const foot = el("div", "sw-foot");
  const note = el("div", "sw-note");
  const backButton = button("Back", "sw-btn", () => {});
  const nextButton = button("Next", "sw-btn sw-primary", () => {});
  const open = new Set<string>();
  const now = deps.now ?? Date.now;
  let closed = false;
  let adding: string | null = null;
  let elapsed: { node: HTMLElement; text: () => string } | null = null;
  const clock = setInterval(() => {
    if (elapsed !== null) {
      elapsed.node.textContent = elapsed.text();
    }
  }, 1000);

  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "Setup");
  head.append(title, where);
  foot.append(note, backButton, nextButton);
  modal.append(head, steps, body, foot);
  scrim.append(modal);

  function close(): void {
    if (closed) {
      return;
    }

    closed = true;
    clearInterval(clock);
    void controller.stop();
    off();
    document.removeEventListener("keydown", onKey, true);
    scrim.remove();
    deps.onClose?.();
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }

  scrim.addEventListener("mousedown", (event) => {
    if (event.target === scrim) {
      close();
    }
  });
  document.addEventListener("keydown", onKey, true);

  function disclosure(id: string, label: string, text: string): HTMLElement[] {
    const box = el("pre", "sw-code sw-mono", text);
    const link = button(label, "sw-link", () => {
      if (open.has(id)) {
        open.delete(id);
      } else {
        open.add(id);
      }

      box.hidden = !open.has(id);
    });

    box.hidden = !open.has(id);

    return [link, box];
  }

  function row(
    lead: HTMLElement | SVGElement | string,
    main: HTMLElement[],
    meta: HTMLElement[] = [],
    className = "",
  ): HTMLElement {
    const one = el("div", `sw-row ${className}`.trim());
    const control = lead instanceof HTMLInputElement ? lead : null;
    const first = el("span", "sw-lead");
    const middle = el("div", "sw-main");
    const last = el("div", "sw-meta");

    if (typeof lead === "string") {
      first.textContent = lead;
    } else {
      first.append(lead);
    }

    const bodies = meta.filter((node) => node.tagName === "PRE");

    middle.append(...main);
    last.append(...meta.filter((node) => node.tagName !== "PRE"));
    one.append(first, middle, last, ...bodies);

    if (control !== null) {
      one.classList.add("pick");
      one.classList.toggle("locked", control.disabled);
      one.addEventListener("click", (event) => {
        const target = event.target as Element;

        if (
          control.disabled ||
          target.closest("button, input, textarea, select, a, label, pre")
        ) {
          return;
        }

        control.click();
      });
    }

    return one;
  }

  function checkbox(
    checked: boolean,
    data: string,
    change: (on: boolean) => void,
    disabled = false,
  ): HTMLInputElement {
    const box = el("input", "sw-check");

    box.type = "checkbox";
    box.checked = checked;
    box.disabled = disabled;
    box.dataset.control = data;
    box.addEventListener("change", () => change(box.checked));

    return box;
  }

  function callout(kind: "" | "ok" | "bad", lines: (HTMLElement | string)[]) {
    const box = el("div", `sw-callout ${kind}`.trim());

    box.append(
      ...lines.map((line) =>
        typeof line === "string" ? el("div", "sw-why", line) : line,
      ),
    );

    return box;
  }

  function limitInput(state: WizardState, label: string): HTMLInputElement {
    const input = el("input", "sw-num");

    input.type = "number";
    input.min = "1";
    input.value = String(state.limits[label] ?? 1);
    input.dataset.limit = label;
    input.addEventListener("change", () =>
      controller.setLimit(label, Number(input.value)),
    );

    return input;
  }

  function filesStep(state: WizardState) {
    const { files, unread } = state.survey;

    body.append(
      el("h2", "", "Files Recognizer reads"),
      el(
        "p",
        "sw-lead-text",
        "Recognizer scanned the repository. Each file becomes one box on the canvas. Nothing to change here.",
      ),
    );

    if (state.survey.configured) {
      const lines = changedSince(state.survey);

      body.append(
        callout("", [
          el("div", "sw-what", "What changed since setup"),
          ...(lines.length === 0
            ? ["Nothing has changed since setup."]
            : lines),
        ]),
      );
    }

    if (files === null) {
      body.append(
        row("i", [
          el("div", "sw-what", "No scan yet"),
          el(
            "div",
            "sw-why",
            "The repository could not be scanned for this survey, so the files are not listed. Setup can still go ahead.",
          ),
        ]),
      );
    }

    for (const language of files ?? []) {
      body.append(
        row(
          "✓",
          [
            el(
              "div",
              "sw-what",
              `${language.files} ${languageName(language.language)} files`,
            ),
            el("div", "sw-why", folderText(language.folders)),
          ],
          markTag(language.mark),
          "found",
        ),
      );
    }

    for (const miss of unread) {
      body.append(
        row(
          "i",
          [
            el("div", "sw-what", `${miss.files} files not read`),
            el(
              "div",
              "sw-why",
              `${folderText(miss.folders)}: no scanner for ${languageName(miss.language)} is installed.`,
            ),
          ],
          [],
          "found",
        ),
      );
    }
  }

  function checksStep(state: WizardState) {
    const analysis = state.survey.checks.find((one) => one.id === "analysis");
    const structure = state.survey.checks.find((one) => one.id === "structure");

    body.append(
      el("h2", "", "Checks"),
      el(
        "p",
        "sw-lead-text",
        "What Recognizer should tell you about this code.",
      ),
    );

    if (structure !== undefined) {
      body.append(
        row("🔒", [
          el("div", "sw-what", `${structure.display} - always on`),
          el("div", "sw-why", structure.description),
        ]),
      );
    }

    if (analysis !== undefined) {
      const list = el("ul", "sw-findlist");

      list.append(
        el(
          "li",
          "",
          "import cycles, files nothing imports, unused exports, and imports of another folder's private files",
        ),
      );

      for (const limit of analysis.limits) {
        const [before, after] = LIMIT_SENTENCES[limit.label] ?? [
          `${limit.label} above `,
          "",
        ];
        const item = el("li", "");

        item.append(before, limitInput(state, limit.label), after);
        list.append(item);
      }

      body.append(
        row(
          checkbox(state.analysis, "analysis", (on) =>
            controller.setAnalysis(on),
          ),
          [
            el("div", "sw-what", analysis.display),
            el(
              "div",
              "sw-why",
              "Runs with every scan and needs no tests, so it is quick. It warns about:",
            ),
            list,
            el(
              "div",
              "sw-why",
              "A warning shows on the canvas and in Findings, and never fails a run. Once you have a policy, an import that breaks it is a violation: recognizer check fails on a new one.",
            ),
          ],
          markTag(analysis.mark),
          state.analysis ? "" : "off",
        ),
      );
    }

    for (const check of pluginChecks(state.survey)) {
      const on = state.plugins[check.id] === true;

      body.append(
        row(
          checkbox(on, `plugin-${check.id}`, (value) =>
            controller.setPlugin(check.id, value),
          ),
          [
            el("div", "sw-what", check.display),
            el("div", "sw-why", check.description),
            ...(check.mark === "set-up" && !on
              ? [el("div", "sw-why", "Unticked, so Apply turns it off.")]
              : []),
            ...(check.runs_tests
              ? [
                  el(
                    "div",
                    "sw-needs",
                    "Needs your tests, run with coverage. The next step sets that up.",
                  ),
                ]
              : []),
          ],
          markTag(check.mark),
          on ? "" : "off",
        ),
      );
    }

    if (!testsWanted(state)) {
      body.append(
        callout("", [
          "No chosen check runs your tests, so the Tests step is skipped.",
        ]),
      );
    }
  }

  function envForm(state: WizardState, name: string): HTMLElement[] {
    const own = state.runners[name];
    const out: HTMLElement[] = [];

    own?.env.forEach(([key, value], at) => {
      const line = el("div", "sw-envrow");

      line.append(
        el("code", "", key),
        el("code", "", value),
        button("Remove", "sw-link", () => controller.removeEnv(name, at)),
      );
      out.push(line);
    });

    if (adding === name) {
      const key = el("input", "sw-text");
      const value = el("input", "sw-text");
      const line = el("div", "sw-envrow");

      key.placeholder = "NAME";
      key.dataset.control = "env-name";
      value.placeholder = "value";
      value.dataset.control = "env-value";
      line.append(
        key,
        value,
        button("Add", "sw-btn sw-small", () => {
          if (controller.addEnv(name, key.value.trim(), value.value)) {
            adding = null;
            render(controller.state());
          } else {
            key.classList.add("bad");
          }
        }),
        button("Cancel", "sw-link", () => {
          adding = null;
          render(controller.state());
        }),
      );
      out.push(line);
    } else {
      if ((own?.env.length ?? 0) === 0) {
        out.push(el("span", "sw-why", "Your login shell's. "));
      }

      out.push(
        button("Add a variable", "sw-link", () => {
          adding = name;
          render(controller.state());
        }),
      );
    }

    return out;
  }

  function runnerCard(state: WizardState, runner: SurveyRunner): HTMLElement {
    const own = state.runners[runner.name];
    const tool = state.survey.tools.find((one) =>
      one.needed_by.includes(runner.name),
    );
    const on = own?.on === true;
    const content: HTMLElement[] = [
      el(
        "div",
        "sw-what",
        `${runner.name} - ${languageName(runner.language)}, ${runner.runner}, found in ${runner.from}`,
      ),
    ];

    if (on && own !== undefined) {
      const command = el("textarea", "sw-cmd sw-mono");

      command.rows = 2;
      command.value = own.command;
      command.dataset.control = `command-${runner.name}`;
      command.addEventListener("change", () =>
        controller.setCommand(runner.name, command.value),
      );

      const grid = el("dl", "sw-kv");
      const commandCell = el("dd", "");

      commandCell.append(command);

      if (own.command !== runner.command) {
        commandCell.append(
          button("Back to the found command", "sw-link", () =>
            controller.setCommand(runner.name, runner.command),
          ),
        );
      }

      const envCell = el("dd", "");

      envCell.append(...envForm(state, runner.name));
      grid.append(
        el("dt", "", "Runs in"),
        el("dd", "sw-mono", `${runner.directory}/`),
        el("dt", "", "Command"),
        commandCell,
        el("dt", "", "Environment"),
        envCell,
      );

      if (tool !== undefined && !tool.installed) {
        const kept = state.tools[tool.name] === true;
        const shared = sharedBy(state, runner);
        const card = el("div", "sw-tool");
        const text = el("div", "");

        text.append(
          el(
            "div",
            "sw-what",
            `Install ${tool.name}${shared.length > 1 ? ` - also used by ${shared.filter((one) => one !== runner.name).join(", ")}` : ""}`,
          ),
          el(
            "div",
            "sw-why",
            `Not installed. ${tool.why}. Changes ${tool.installs}.`,
          ),
        );

        if (!kept) {
          text.append(
            el(
              "div",
              "sw-warnline",
              `Without it this command fails, so ${shared.join(" and ")} ${shared.length > 1 ? "are" : "is"} left out. Install it yourself and run setup again to add ${shared.length > 1 ? "them" : "it"}.`,
            ),
          );
        }

        card.append(
          checkbox(kept, `tool-${tool.name}`, (value) =>
            controller.setTool(tool.name, value),
          ),
          text,
        );

        const needs = el("dd", "");

        needs.append(card);
        grid.append(el("dt", "", "Needs"), needs);
      }

      content.push(grid);
    } else {
      content.push(
        el(
          "div",
          "sw-warnline",
          `${runner.directory}/ gets no C.R.A.P. or Mutation results.`,
        ),
      );
    }

    return row(
      checkbox(on, `runner-${runner.name}`, (value) =>
        controller.setRunner(runner.name, value),
      ),
      content,
      state.survey.configured ? markTag("new") : [],
      on && (tool === undefined || tool.installed || state.tools[tool.name])
        ? ""
        : "off",
    );
  }

  function timeTag(row: Timed): HTMLElement[] {
    return row.state === "done" && row.startedAt !== null
      ? [
          el(
            "span",
            "sw-time sw-mono",
            elapsedText((row.endedAt ?? 0) - row.startedAt),
          ),
        ]
      : [];
  }

  function rowsList(rows: Row[], id: string): HTMLElement[] {
    return rows.map((one, at) => {
      const main = [el("div", "sw-what", one.title)];

      if (one.state === "undone") {
        main.push(el("div", "sw-why", `Undone ${one.output}`.trim()));
      }

      if (one.state === "running" && one.step !== undefined) {
        main.push(
          el("div", "sw-why", `Step ${one.step} of ${one.steps ?? one.step}`),
        );
      }

      if (one.state === "running" && one.command !== undefined) {
        main.push(el("div", "sw-why sw-mono sw-command", one.command));
      }

      const meta: HTMLElement[] = [];

      if (one.state === "done" && one.startedAt != null) {
        meta.push(
          ...timeTag({
            state: "done",
            startedAt: one.startedAt,
            endedAt: one.endedAt ?? one.startedAt,
          }),
        );
      }

      if (one.output !== "" && one.state !== "undone") {
        meta.push(...disclosure(`${id}-${at}`, "Output", one.output));
      }

      const kind = STATE_ICON[one.state];

      return row(
        kind === undefined ? (GLYPH[one.state] ?? "") : icon(kind),
        main,
        meta,
        `state-${one.state}`,
      );
    });
  }

  function stepRow(title: string, timed: Timed, detail: string[] = []) {
    return row(
      icon(STATE_ICON[timed.state] as IconKind),
      [
        el("div", "sw-what", title),
        ...detail.map((line) => el("div", "sw-why sw-mono", line)),
      ],
      timeTag(timed),
      `state-${timed.state}`,
    );
  }

  function suiteRow(state: WizardState, suite: SurveySuite): HTMLElement {
    const where = `${suite.directory}/`;

    if (suite.mark === "gone") {
      const on = state.removals[suite.name] === true;

      return row(
        checkbox(on, `remove-${suite.name}`, (value) =>
          controller.setRemoval(suite.name, value),
        ),
        [
          el("div", "sw-what", `${suite.name} - ${where} has no files now`),
          el("div", "sw-why", "Remove from the config"),
        ],
        markTag("gone"),
        on ? "" : "off",
      );
    }

    const env = Object.entries(suite.env ?? {})
      .map(([key, value]) => `${key}=${value}`)
      .join(" ");

    return row(
      "✓",
      [
        el("div", "sw-what", `${suite.name} - ${where}`),
        el(
          "div",
          "sw-why sw-mono",
          env === "" ? suite.command : `${env} ${suite.command}`,
        ),
      ],
      markTag("set-up"),
      "found",
    );
  }

  function testsStep(state: WizardState) {
    const who = pluginChecks(state.survey)
      .filter((check) => check.runs_tests && state.plugins[check.id] === true)
      .map((check) => check.display);

    body.append(
      el("h2", "", "Running your tests"),
      el(
        "p",
        "sw-lead-text",
        `${who.join(" and ")} run${who.length > 1 ? "" : "s"} your tests with coverage turned on. These are the test runners found in the repository, and the command Recognizer will use for each. Change a command, or add environment variables, if your tests need them.`,
      ),
    );

    for (const suite of state.survey.suites) {
      body.append(suiteRow(state, suite));
    }

    for (const runner of state.survey.runners) {
      body.append(runnerCard(state, runner));
    }

    for (const survey of state.survey.notes ?? []) {
      body.append(el("div", "sw-note sw-why", survey.text));
    }

    const tried = state.tried;
    const holder = el("div", "sw-tryout");

    if (tried.kind === "idle" || tried.kind === "error") {
      holder.append(
        callout("", [
          el("div", "sw-what", "Try the commands"),
          el(
            "div",
            "sw-why",
            "Optional. Installs what a command needs, runs the readiness check once, then undoes the changes.",
          ),
          ...(tried.kind === "error"
            ? [el("div", "sw-why bad", tried.message)]
            : []),
          button("Run once", "sw-btn sw-small", () => {
            void controller.runOnce();
          }),
        ]),
      );
    } else if (tried.kind === "running") {
      holder.append(
        callout("", [
          el("div", "sw-what", "Running the commands once"),
          ...rowsList(tried.rows, "try"),
          button("Stop", "sw-btn sw-small", () => {
            void controller.stop();
          }),
        ]),
      );
    } else {
      holder.append(
        callout(tried.ok ? "ok" : "bad", [
          el(
            "div",
            "sw-what",
            tried.ok
              ? "Every command ran and measured coverage"
              : "Some commands did not get ready",
          ),
          ...tried.runners.flatMap((one) => [
            el(
              "div",
              `sw-runner ${one.ready ? "ready" : "notready"}`,
              one.ready
                ? `${one.name}: ready`
                : `${one.name}: not ready - ${one.detail}`,
            ),
            ...(one.ready || one.output === ""
              ? []
              : disclosure(`rn-${one.name}`, "Output", one.output)),
          ]),
          el(
            "div",
            "sw-why",
            "The changes were undone. Apply makes them for real.",
          ),
          button("Run once", "sw-btn sw-small", () => {
            void controller.runOnce();
          }),
        ]),
      );
    }

    body.append(holder);
  }

  function card(state: WizardState, index: number, entry: PolicyCard) {
    const decision = state.decisions[index];
    const one = el(
      "div",
      `sw-rec ${decision === "accept" ? "accepted" : decision === "reject" ? "rejected" : ""}`.trim(),
    );
    const top = el("div", "sw-top");
    const acts = el("div", "sw-acts");
    const grid = el("dl", "sw-kv");

    for (const choice of ["accept", "reject"] as const) {
      const act = button(
        choice === "accept" ? "Accept" : "Reject",
        `sw-btn sw-small ${decision === choice ? "on" : ""}`.trim(),
        () => controller.decide(index, choice),
      );

      act.dataset.decide = `${index}:${choice}`;
      acts.append(act);
    }

    top.append(el("div", "sw-what", cardHead(entry)), acts);

    const files =
      entry.kind === "ignore"
        ? entry.globs
        : entry.kind === "entry"
          ? entry.paths
          : [];

    if (files.length > 0) {
      const list = el("ul", "sw-evid sw-mono");

      for (const file of files) {
        list.append(el("li", "", file));
      }

      const cell = el("dd", "");

      cell.append(list);
      grid.append(el("dt", "", "Files"), cell);
    }

    grid.append(
      el("dt", "", "Why"),
      el("dd", "", entry.why),
      el("dt", "", "Based on"),
      el("dd", "sw-mono", entry.based_on),
    );

    if (entry.kind === "forbid" && entry.today !== undefined) {
      grid.append(
        el("dt", "", "Today"),
        el(
          "dd",
          "",
          entry.today.count === 0
            ? "No import breaks it."
            : `${entry.today.count} import${entry.today.count === 1 ? "" : "s"} break${entry.today.count === 1 ? "s" : ""} it${entry.today.example === null ? "" : `: ${entry.today.example}`}. It is recorded as known, so only a new one fails recognizer check.`,
        ),
      );
    }

    one.append(top, grid);

    return one;
  }

  function policyStep(state: WizardState) {
    body.append(
      el("h2", "", "Dependency policy"),
      el(
        "p",
        "sw-lead-text",
        "A policy names the parts of your code and which may import which. Structural analysis then reports every import that breaks it as a violation, and recognizer check fails CI when a new one appears. Every codebase is shaped differently, so Claude reads this one's imports and recommends parts and rules. You accept or reject each one; only what you accept is saved.",
      ),
    );

    const run = state.policy;

    if (run.kind === "running") {
      body.append(
        row(
          "◌",
          [
            el("div", "sw-what", "Claude is reading the imports"),
            el("div", "sw-progress sw-mono", run.lines.join("\n")),
          ],
          [
            button("Stop", "sw-btn sw-small", () => {
              void controller.stop();
            }),
          ],
        ),
      );

      return;
    }

    if (run.kind === "done") {
      const entries = run.recommendation.entries;
      const accepted = acceptedCards(state).length;
      const open = undecidedCards(state);
      const bar = el("div", "sw-bar-row");

      bar.append(
        el("span", "sw-count", `${accepted} accepted, ${open} to decide`),
        button("Accept all remaining", "sw-link", () =>
          controller.acceptRemaining(),
        ),
        button("Ask again", "sw-link", () => {
          void controller.askClaude();
        }),
      );
      body.append(
        el(
          "p",
          "sw-lead-text",
          `Claude recommends ${entries.length} ${entries.length === 1 ? "entry" : "entries"}. Accept or reject each one; only what you accept is saved.`,
        ),
        bar,
      );

      const groups: [string, string, (entry: PolicyCard) => boolean][] = [
        ["Left out", "", (entry) => entry.kind !== "forbid"],
        [
          "Rules",
          "Any import a rule does not name is allowed.",
          (entry) => entry.kind === "forbid",
        ],
      ];

      for (const [name, sub, test] of groups) {
        const members = entries
          .map((entry, at) => ({ entry, at }))
          .filter(({ entry }) => test(entry));

        if (members.length === 0) {
          continue;
        }

        body.append(el("h3", "sw-group", name));

        if (sub !== "") {
          body.append(el("div", "sw-why", sub));
        }

        for (const { entry, at } of members) {
          body.append(card(state, at, entry));
        }
      }

      for (const dropped of run.recommendation.dropped) {
        body.append(
          callout("", [
            `Left out of the list: ${dropped.summary} - ${dropped.reason}.`,
          ]),
        );
      }

      return;
    }

    const kept = state.survey.configured && state.survey.policy.present;
    const choices: ["skip" | "ask", string, string][] = [
      kept
        ? ["skip", "Keep it as it is", "Change it later from the Policy panel."]
        : ["skip", "Skip for now", "Add one later from the Policy panel."],
      [
        "ask",
        kept
          ? "Ask Claude to recommend changes"
          : "Ask Claude for recommendations",
        "Claude reads the imports and recommends parts and rules, each with the imports behind it. Uses your Claude account. Nothing is saved until you accept it and apply.",
      ],
    ];

    if (state.survey.policy.uncovered.length > 0) {
      body.append(
        el(
          "p",
          "sw-why sw-uncovered",
          `Not covered by the policy: ${state.survey.policy.uncovered.join(", ")}.`,
        ),
      );
    }

    for (const [id, what, why] of choices) {
      const radio = el("input", "sw-check");

      radio.type = "radio";
      radio.name = "policy-mode";
      radio.checked = state.policyMode === id;
      radio.dataset.control = `policy-${id}`;
      radio.addEventListener("change", () => controller.setPolicyMode(id));

      const main: HTMLElement[] = [
        el("div", "sw-what", what),
        el("div", "sw-why", why),
      ];

      if (id === "ask" && state.policyMode === "ask") {
        main.push(
          button("Ask Claude", "sw-btn sw-small sw-primary", () => {
            void controller.askClaude();
          }),
        );
      }

      body.append(row(radio, main));
    }

    if (run.kind === "failed") {
      const alert = callout("bad", [run.message]);

      alert.setAttribute("role", "alert");
      body.append(alert);
    }

    if (!state.analysis) {
      body.append(
        callout("", [
          "Structural analysis is off, so a policy is kept but nothing is judged against it until you turn it on.",
        ]),
      );
    }
  }

  function fixRows(state: WizardState) {
    const fixes = state.survey.fixes;

    if (fixes.length === 0) {
      return;
    }

    body.append(el("h3", "sw-group", "Doctor's fixes"));

    fixes.forEach((fix, at) => {
      if (fix.command === null) {
        body.append(
          row(
            "✎",
            [
              el("div", "sw-what", fix.title),
              el("div", "sw-why", fix.fix_text),
              el(
                "div",
                "sw-why",
                "Doctor keeps reporting this until it is fixed by hand.",
              ),
            ],
            disclosure(`fx-${at}`, "Details", fix.line),
          ),
        );

        return;
      }

      const on = state.fixes[at] === true;

      body.append(
        row(
          checkbox(on, `fix-${at}`, (value) => controller.setFix(at, value)),
          [
            el("div", "sw-what", fix.title),
            ...(on
              ? []
              : [
                  el(
                    "div",
                    "sw-why",
                    "Doctor keeps reporting this until it is fixed. Open Setup again to apply it later.",
                  ),
                ]),
          ],
          disclosure(`fx-${at}`, "Details", `${fix.line}\n\n${fix.command}`),
          on ? "" : "off",
        ),
      );
    });
  }

  function reviewStep(state: WizardState) {
    const changes = changesOf(state);

    body.append(
      el("h2", "", "Review"),
      el(
        "p",
        "sw-lead-text",
        "Everything that will change, in the order it runs. Nothing has changed yet.",
      ),
    );

    fixRows(state);

    const groups: [string, PlannedChange["group"]][] = [
      ["Checks", "checks"],
      ["Tests", "tests"],
      ["Policy", "policy"],
    ];

    for (const [heading, group] of groups) {
      const members = changes.filter((change) => change.group === group);

      if (members.length === 0) {
        continue;
      }

      body.append(el("h3", "sw-group", heading));

      for (const change of members) {
        const at = changes.indexOf(change);

        body.append(
          row(
            "○",
            [el("div", "sw-what", change.title)],
            change.detail === undefined
              ? disclosure(`rv-${at}`, "Command", commandText(change))
              : disclosure(
                  `rv-${at}`,
                  "Details",
                  `${change.detail}\n\n${commandText(change)}`,
                ),
          ),
        );
      }
    }

    if (changes.length === 0) {
      body.append(el("p", "sw-empty", "Nothing to change."));
    }

    for (const dropped of droppedOf(state)) {
      body.append(
        callout("", [
          `${dropped.runner} is left out: ${dropped.tool} is not being installed.`,
        ]),
      );
    }

    body.append(
      callout("", [
        "All or nothing: if a change fails, the ones before it are undone and the repository is left as it was.",
      ]),
    );
  }

  function applyStep(state: WizardState) {
    const run = state.apply;

    if (run === null) {
      return;
    }

    const read = run.doctor?.status === "ok" ? run.doctor.report : null;
    const remaining =
      read === null
        ? []
        : read.areas
            .flatMap((area) => area.problems)
            .filter((one) => one.severity === "problem");
    const clean = read !== null && read.problems === 0;
    const heading =
      run.state === "done"
        ? clean
          ? "Everything is up to date"
          : read === null
            ? "Updated"
            : `Updated - ${read.problems} thing${read.problems === 1 ? "" : "s"} still to fix`
        : run.state === "running"
          ? "Applying"
          : "Setup stopped";
    const bar = el("div", "sw-bar");
    const fill = el("i", `sw-fill ${run.state}`);
    const headRow = el("div", "sw-headrow");
    const time = el("span", "sw-elapsed sw-mono");
    const elapsedNow = () =>
      elapsedText((run.endedAt ?? now()) - run.startedAt);

    fill.style.width =
      run.state === "running" ? `${Math.round(run.fill * 100)}%` : "100%";
    bar.append(fill);
    time.textContent = elapsedNow();
    elapsed = run.endedAt === null ? { node: time, text: elapsedNow } : null;
    headRow.append(el("h2", "", heading), time);
    body.append(headRow, bar);

    if (run.state === "done") {
      body.append(
        callout(
          clean ? "ok" : "",
          clean || read === null
            ? [
                el(
                  "div",
                  "sw-what",
                  clean ? "Doctor finds no problems." : "Doctor could not run.",
                ),
                "The changes are live in this window.",
              ]
            : [
                ...remaining.flatMap((one) => [
                  el("div", "sw-what", one.title),
                  el("div", "sw-why", one.fix.text),
                ]),
                "The changes are live in this window.",
              ],
        ),
      );
    } else if (run.state === "failed" || run.state === "stopped") {
      const failed = run.rows.find((one) => one.state === "failed");
      const alert = callout("bad", [
        el(
          "div",
          "sw-what",
          run.state === "stopped"
            ? "Stopped, so nothing was changed."
            : `${failed?.title ?? "A change"} failed, so nothing was changed.`,
        ),
        el("div", "sw-why", run.message ?? failed?.output ?? ""),
      ]);

      alert.setAttribute("role", "alert");
      body.append(alert);
    }

    body.append(...rowsList(run.rows, "ap"));

    if (run.state === "running" || run.state === "done") {
      body.append(
        stepRow("Checking the setup", run.checking),
        stepRow("Loading the checks", run.loading),
      );
    }
  }

  function loadingStep(progress: LoadingState) {
    const timeNow = now();
    const headRow = el("div", "sw-headrow");
    const time = el("span", "sw-elapsed sw-mono");
    const elapsedNow = () => elapsedText(now() - progress.startedAt);
    const bar = el("div", "sw-bar");
    const fill = el("i", "sw-fill running");

    time.textContent = elapsedNow();
    elapsed = { node: time, text: elapsedNow };
    headRow.append(el("h2", "", "Reading the repository"), time);
    fill.style.width = `${Math.round(progress.fill * 100)}%`;
    bar.append(fill);
    body.append(headRow, bar);

    if (progress.scan !== null) {
      body.append(
        el(
          "p",
          "sw-lead-text",
          "This happens once, the first time Setup opens on a folder that has never been scanned.",
        ),
      );
    }

    const lines: string[] = progress.languages
      .filter((one) => one.state !== "waiting")
      .map((one) =>
        one.state === "done"
          ? `${languageName(one.name)}: ${one.files ?? 0} files`
          : `${languageName(one.name)}: reading...`,
      );

    if (progress.duplication !== null) {
      lines.push(
        progress.duplication.state === "comparing"
          ? "Duplication: comparing..."
          : progress.duplication.state === "failed"
            ? "Duplication: could not compare"
            : `Duplication: ${progress.duplication.files ?? 0} files compared`,
      );
    }

    const timed = (row: Timed): Timed =>
      row.state === "done" ? row : { ...row, endedAt: timeNow };

    body.append(
      stepRow("Finding languages and test setups", timed(progress.survey)),
      ...(progress.scan === null
        ? []
        : [stepRow("Scanning the files", timed(progress.scan), lines)]),
      stepRow("Reading what the scan found", timed(progress.reading)),
    );
  }

  function renderSteps(state: WizardState) {
    steps.replaceChildren();

    SETUP_STEPS.forEach((one, at) => {
      const skipped = isSkipped(state, one.key);
      const kind = skipped
        ? "skip"
        : at < state.at
          ? "done"
          : at === state.at
            ? "now"
            : "";
      const item = el("div", `sw-step ${kind}`.trim());

      item.dataset.step = one.key;
      item.append(
        el("i", "sw-tick"),
        el("span", "", `${kind === "done" ? "✓ " : ""}${one.name}`),
      );
      item.addEventListener("click", () => controller.goto(at));
      steps.append(item);
    });
  }

  function footer(state: WizardState) {
    const key = currentKey(state);
    const total = SETUP_STEPS.length;
    const run = state.apply;

    backButton.hidden = state.at === 0 || key === "apply";
    backButton.textContent = "Back";
    nextButton.disabled = !canNext(state);
    nextButton.classList.add("sw-primary");
    nextButton.textContent = "Next";
    note.textContent = `Step ${state.at + 1} of ${total}`;
    nextButton.onclick = () => controller.next();
    backButton.onclick = () => controller.back();

    if (key === "policy" && state.policy.kind === "done") {
      const open = undecidedCards(state);

      nextButton.textContent =
        open > 0 ? `Next, leaving ${open} undecided` : "Next";
    }

    if (key === "review") {
      const count = changesOf(state).length;

      if (count === 0) {
        nextButton.disabled = false;
        nextButton.textContent = "Close";
        nextButton.onclick = () => close();
      } else {
        nextButton.textContent = `Apply ${count} change${count === 1 ? "" : "s"}`;
        nextButton.onclick = () => {
          void controller.apply();
        };
      }
    }

    if (key === "apply" && run !== null) {
      nextButton.disabled = false;

      if (run.state === "running") {
        nextButton.textContent = "Stop";
        nextButton.classList.remove("sw-primary");
        note.textContent = `Change ${Math.min(run.rows.findIndex((one) => one.state === "running") + 1 || run.rows.length, run.rows.length)} of ${run.rows.length}`;
        nextButton.onclick = () => {
          void controller.stop();
        };
      } else if (run.state === "done") {
        nextButton.textContent = "Close";
        note.textContent =
          "A log of this run is saved in .recognizer/cache/log";
        nextButton.onclick = () => close();
      } else {
        nextButton.textContent = "Try again";
        backButton.hidden = false;
        backButton.textContent = "Back to review";
        backButton.onclick = () => controller.backToReview();
        note.textContent =
          "A log of this run is saved in .recognizer/cache/log";
        nextButton.onclick = () => {
          void controller.apply();
        };
      }
    }
  }

  function render(state: SetupState): void {
    if (closed) {
      return;
    }

    body.replaceChildren();
    elapsed = null;

    if (state.kind === "loading") {
      title.textContent = "Set up";
      steps.replaceChildren();
      loadingStep(state.progress);
      nextButton.disabled = true;
      backButton.hidden = true;
      note.textContent = "";

      return;
    }

    if (state.kind === "unavailable") {
      const alert = el("p", "sw-error", state.reason);

      alert.setAttribute("role", "alert");
      steps.replaceChildren();
      body.append(el("h2", "", "Setup could not read the repository"), alert);
      nextButton.textContent = "Close";
      nextButton.disabled = false;
      nextButton.onclick = () => close();
      backButton.hidden = true;
      note.textContent = "";

      return;
    }

    const name = state.survey.repository.split("/").pop() ?? "";

    title.textContent = `Set up ${name}`;
    where.textContent = state.survey.repository;
    renderSteps(state);

    const key = currentKey(state);

    if (key === "files") filesStep(state);
    else if (key === "checks") checksStep(state);
    else if (key === "tests") testsStep(state);
    else if (key === "policy") policyStep(state);
    else if (key === "review") reviewStep(state);
    else applyStep(state);

    footer(state);
  }

  const off = controller.subscribe(render);
  const ready = controller.open();

  render(controller.state());
  document.body.append(scrim);

  return { element: scrim, ready, controller, close };
}
