import { quoteCommand, type SetupSection } from "recognizer";
import { button, el } from "./dom";
import { estimateText } from "./setup-estimate";
import {
  canApply,
  createSetupController,
  doctorLines,
  type ReportState,
  runSummary,
  SECTION_NAMES,
  type SetupController,
  type SetupState,
  sectionCounts,
  sectionsOf,
} from "./setup-model";
import type { DoctorRead, SetupApplyOutcome, SetupPort } from "./setup-port";

export type SetupModalDeps = {
  port: SetupPort;
  readModel: () => Promise<string>;
  onDoctor?: (read: DoctorRead) => void;
  onClose?: () => void;
};

export type SetupModal = {
  element: HTMLElement;
  ready: Promise<void>;
  controller: SetupController;
  close(): void;
};

export const CHECK_INFO =
  "Check with Claude runs Claude once, read-only, over this repository with the setup guide, and proposes changes you tick before anything is applied.";

function outcomeText(outcome: SetupApplyOutcome): string {
  switch (outcome.status) {
    case "applied":
      return `${outcome.applied} of ${outcome.total} applied.`;
    case "stopped":
      return `Stopped: ${outcome.applied} of ${outcome.total} applied.`;
    case "refused":
      return `Refused: ${outcome.reason}`;
    case "failed":
      return `Failed: ${outcome.applied} of ${outcome.total} applied.`;
  }
}

export function openSetupModal(deps: SetupModalDeps): SetupModal {
  const controller = createSetupController({
    port: deps.port,
    readModel: deps.readModel,
    ...(deps.onDoctor === undefined ? {} : { onDoctor: deps.onDoctor }),
  });
  const scrim = el("div", "settings-scrim");
  const modal = el("div", "settings-modal setup-modal");
  const head = el("div", "sm-head");
  const nav = el("nav", "sm-nav");
  const pane = el("div", "sm-pane");
  const foot = el("div", "sm-foot");
  const message = el("span", "sm-message");
  const title = el("span", "su-title", "Setup");
  const summary = el("span", "su-run");
  let closed = false;

  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "Setup");
  head.append(title, summary);
  modal.append(head, nav, pane, foot);
  scrim.append(modal);

  function renderNav(state: SetupState): void {
    nav.replaceChildren();

    const group = (name: string) => {
      nav.append(el("div", "sm-group", name));
    };
    const entry = (
      label: string,
      on: boolean,
      count: string | null,
      pick: (() => void) | null,
      section: string,
    ) => {
      const one = button(label, "sm-entry", () => pick?.());

      one.classList.toggle("on", on);
      one.dataset.section = section;

      if (count !== null) {
        one.append(el("span", "su-count", count));
      }

      nav.append(one);
    };

    if (state.kind === "report") {
      group("Proposal");

      for (const section of sectionsOf(state)) {
        const { ticked, total } = sectionCounts(state, section);

        entry(
          SECTION_NAMES[section],
          state.section === section,
          `${ticked} of ${total}`,
          () => controller.select(section),
          section,
        );
      }

      return;
    }

    group("Setup");
    entry("Doctor", true, null, null, "doctor");
  }

  function reportPane(state: ReportState): void {
    const section: SetupSection | null = state.section;

    pane.append(el("h2", "", "Proposed changes"));

    if (state.summary !== "") {
      pane.append(el("div", "sm-where", state.summary));
    }

    if (state.changes.length === 0) {
      pane.append(el("p", "su-empty", "Nothing to change"));
    }

    state.changes.forEach((change, at) => {
      if (change.section !== section) {
        return;
      }

      const card = el("div", "sm-card su-change");
      const label = el("label", "su-change-head");
      const box = el("input");

      box.type = "checkbox";
      box.checked = state.ticks[at] === true;
      box.addEventListener("change", () => controller.toggle(at));
      label.append(box, el("span", "su-change-title", change.title));

      if (change.runsTests) {
        label.append(el("span", "su-badge", "Runs the tests"));
      }

      if (change.registersProgram) {
        label.append(el("span", "su-badge", "Registers a program"));
      }

      card.append(label, el("p", "su-reason", change.reason));

      for (const argv of change.commands) {
        card.append(el("code", "su-command", quoteCommand(argv)));
      }

      pane.append(card);
    });
  }

  function render(state: SetupState): void {
    pane.replaceChildren();
    foot.replaceChildren();
    message.textContent = "";
    message.classList.remove("bad");
    summary.textContent = "";
    renderNav(state);

    const close = button("Close", "", () => closeModal());

    switch (state.kind) {
      case "start": {
        pane.append(
          el("h2", "", "Setup"),
          el("div", "sm-where", "What recognizer doctor reports"),
        );

        for (const line of doctorLines(state.doctor)) {
          pane.append(el("p", "su-line", line));
        }

        pane.append(
          el("p", "su-info", CHECK_INFO),
          el(
            "p",
            "su-estimate",
            state.model === "" ? "" : estimateText(state.model),
          ),
        );

        const check = button("Check with Claude", "primary", () => {
          void controller.check();
        });

        check.disabled = state.model === "";
        foot.append(message, close, check);
        break;
      }

      case "checking": {
        pane.append(el("h2", "", "Checking with Claude"));

        for (const line of state.lines) {
          pane.append(el("p", "su-progress", line));
        }

        foot.append(
          message,
          button("Cancel", "", () => void controller.cancel()),
        );
        break;
      }

      case "report": {
        summary.textContent = runSummary(state.costUsd, state.durationMs);
        reportPane(state);

        if (state.dropped.length > 0) {
          message.textContent = `Left out: ${state.dropped
            .map((one) => `${one.title} (${one.refusal})`)
            .join("; ")}`;
          message.classList.add("bad");
        }

        const apply = button("Apply", "primary", () => {
          void controller.apply();
        });

        apply.disabled = !canApply(state);
        foot.append(message, close, apply);
        break;
      }

      case "applying": {
        pane.append(
          el("h2", "", "Applying"),
          el("p", "su-progress", "Running the ticked commands in order."),
        );
        foot.append(
          message,
          button("Stop", "", () => void controller.stop()),
        );
        break;
      }

      case "applied": {
        summary.textContent = runSummary(
          state.report.costUsd,
          state.report.durationMs,
        );
        pane.append(
          el("h2", "", "Applied"),
          el("p", "su-line", outcomeText(state.outcome)),
        );

        if (state.outcome.status === "failed") {
          pane.append(
            el("code", "su-command", quoteCommand(state.outcome.command)),
            el(
              "p",
              "su-line",
              `Exit code ${state.outcome.code === null ? "none" : state.outcome.code}`,
            ),
            el("pre", "su-stderr", state.outcome.stderr),
          );
          message.classList.add("bad");
        }

        pane.append(
          el("div", "sm-where", "What recognizer doctor reports now"),
        );

        for (const line of doctorLines(state.doctor)) {
          pane.append(el("p", "su-line", line));
        }

        foot.append(
          message,
          button("Back to the report", "", () => controller.back()),
          close,
        );
        break;
      }

      case "error": {
        summary.textContent = runSummary(state.costUsd, state.durationMs);
        pane.append(el("h2", "", "Setup could not finish"));

        const reason = el("p", "su-line su-error", state.message);

        reason.setAttribute("role", "alert");
        pane.append(reason);

        if (state.detail !== null) {
          pane.append(el("p", "su-line", state.detail));
        }

        foot.append(
          message,
          button("Back", "", () => controller.back()),
          close,
        );
        break;
      }
    }
  }

  function closeModal(): void {
    if (closed) {
      return;
    }

    closed = true;

    const kind = controller.state().kind;

    if (kind === "checking" || kind === "applying") {
      void deps.port.stop();
    }

    document.removeEventListener("keydown", onKey, true);
    scrim.remove();
    deps.onClose?.();
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      event.stopPropagation();
      closeModal();
    }
  }

  controller.subscribe(render);
  scrim.addEventListener("mousedown", (event) => {
    if (event.target === scrim) {
      closeModal();
    }
  });
  document.addEventListener("keydown", onKey, true);
  document.body.append(scrim);
  render(controller.state());

  const ready = controller.open().catch((error: unknown) => {
    message.textContent =
      error instanceof Error ? error.message : String(error);
    message.classList.add("bad");
  });

  return { element: scrim, ready, controller, close: closeModal };
}
