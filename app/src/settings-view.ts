import { icon } from "./icons";
import {
  checkDescribing,
  type DescribingValues,
  MAX_BATCH_SIZE,
  MAX_CONFIRM_ABOVE_USD,
} from "./settings-model";

export type SettingsValues = {
  editor: string;
  describing: DescribingValues;
};

export type SettingsActions = {
  save: (values: SettingsValues) => void;
  cancel: () => void;
};

export type SettingsView = {
  fill: (values: SettingsValues) => void;
  showError: (text: string) => void;
};

export const EDITOR_INFO =
  "An app name such as Sublime Text, or a command such as code -g {file}:{line}. Without {file} and {line} the file opens at the top. Terminal editors are not supported.";

export const MODEL_INFO =
  "The model every description uses, for scans started from the app and from a terminal.";

export const CONFIRM_INFO =
  "A scan asks before describing when its estimated cost, at API prices, is above this.";

export const EDITOR_HINT = "An app name or a command";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  node.className = className;

  if (text !== undefined) {
    node.textContent = text;
  }

  return node;
}

function row(
  label: string,
  control: HTMLInputElement,
  options: { info?: string; hint?: string; unit?: string; narrow?: boolean },
): HTMLDivElement {
  const node = el("div", "setting");
  const name = el("div", "row-name");
  const text = el("label", "row-label", label);
  const body = el("div", "row-control");
  const id = `settings-${control.name}`;

  control.id = id;
  text.htmlFor = id;
  name.append(text);

  if (options.info !== undefined) {
    const tipId = `${id}-tip`;
    const info = el("button", "setting-info");
    const tip = el("div", "setting-tip", options.info);

    info.type = "button";
    info.setAttribute("aria-label", `About ${label}`);
    info.setAttribute("aria-describedby", tipId);
    info.append(icon("info"));
    tip.id = tipId;
    tip.setAttribute("role", "tooltip");
    name.append(info, tip);
  }

  body.append(control);
  control.classList.toggle("narrow", options.narrow === true);

  if (options.unit !== undefined) {
    body.append(el("span", "unit", options.unit));
  }

  if (options.hint !== undefined) {
    body.append(el("p", "hint", options.hint));
  }

  node.append(name, body);

  return node;
}

function section(title: string, rows: HTMLElement[]): HTMLElement {
  const node = el("section", "section");
  const group = el("div", "group");

  group.append(...rows);
  node.append(el("h2", "section-label", title), group);

  return node;
}

function textInput(placeholder: string, name: string): HTMLInputElement {
  const node = document.createElement("input");

  node.type = "text";
  node.name = name;
  node.placeholder = placeholder;
  node.spellcheck = false;
  node.autocomplete = "off";

  return node;
}

function numberInput(
  name: string,
  range: { min: number; max: number; step: string },
): HTMLInputElement {
  const node = document.createElement("input");

  node.type = "number";
  node.name = name;
  node.min = String(range.min);
  node.max = String(range.max);
  node.step = range.step;

  return node;
}

export function buildSettings(
  container: HTMLElement,
  actions: SettingsActions,
): SettingsView {
  const form = document.createElement("form");
  const editor = textInput("System default", "editor");
  const model = textInput("haiku", "model");
  const batchSize = numberInput("batch_size", {
    min: 1,
    max: MAX_BATCH_SIZE,
    step: "1",
  });
  const confirmAbove = numberInput("confirm_above_usd", {
    min: 0,
    max: MAX_CONFIRM_ABOVE_USD,
    step: "0.01",
  });
  const error = document.createElement("p");
  const buttons = document.createElement("div");
  const saveButton = document.createElement("button");
  const cancelButton = document.createElement("button");

  error.className = "error";
  error.setAttribute("role", "alert");
  buttons.className = "buttons";
  saveButton.type = "submit";
  saveButton.textContent = "Save";
  cancelButton.type = "button";
  cancelButton.textContent = "Cancel";
  cancelButton.addEventListener("click", actions.cancel);
  buttons.append(cancelButton, saveButton);

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const checked = checkDescribing(
      model.value,
      batchSize.value,
      confirmAbove.value,
    );

    if (!checked.ok) {
      error.textContent = checked.error;

      return;
    }

    error.textContent = "";
    actions.save({ editor: editor.value.trim(), describing: checked.value });
  });

  form.append(
    section("Editor", [
      row("Open files in", editor, { info: EDITOR_INFO, hint: EDITOR_HINT }),
    ]),
    section("Describing", [
      row("Model", model, { info: MODEL_INFO }),
      row("Batch size", batchSize, { unit: "modules at a time", narrow: true }),
      row("Ask above", confirmAbove, {
        info: CONFIRM_INFO,
        unit: "USD per scan",
        narrow: true,
      }),
    ]),
    error,
    buttons,
  );
  container.replaceChildren(form);

  return {
    fill(values) {
      editor.value = values.editor;
      model.value = values.describing.model;
      batchSize.value = String(values.describing.batchSize);
      confirmAbove.value = values.describing.confirmAboveUsd.toFixed(2);
    },
    showError(text) {
      error.textContent = text;
    },
  };
}
