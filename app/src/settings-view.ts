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

export const EDITOR_HINT =
  "An app name such as Sublime Text, or a command for a GUI editor such as code or code --goto. Use {file} and {line} to open at a line, for example code -g {file}:{line}; without them the file opens at the top. Terminal editors are not supported.";

function field(label: string, control: HTMLElement): HTMLLabelElement {
  const node = document.createElement("label");
  const text = document.createElement("span");

  text.textContent = label;
  node.append(text, control);

  return node;
}

export const DESCRIBING_HINT =
  "The model every description uses, and how many modules are described at once. Applies to scans started from the app and from a terminal.";

export const CONFIRM_HINT =
  "A scan asks before describing when its API-equivalent estimate is above this.";

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

function hintNode(text: string): HTMLParagraphElement {
  const node = document.createElement("p");

  node.className = "hint";
  node.textContent = text;

  return node;
}

export function buildSettings(
  container: HTMLElement,
  actions: SettingsActions,
): SettingsView {
  const form = document.createElement("form");
  const editor = textInput("System default", "editor");
  const describing = document.createElement("fieldset");
  const describingLegend = document.createElement("legend");
  const describingRow = document.createElement("div");
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

  describing.className = "describing";
  describingLegend.textContent = "Describing";
  describingRow.className = "describing-fields";
  describingRow.append(
    field("Model", model),
    field("Batch size", batchSize),
    field("Confirm above (USD)", confirmAbove),
  );
  describing.append(
    describingLegend,
    describingRow,
    hintNode(DESCRIBING_HINT),
    hintNode(CONFIRM_HINT),
  );
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
    field("Editor", editor),
    hintNode(EDITOR_HINT),
    describing,
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
