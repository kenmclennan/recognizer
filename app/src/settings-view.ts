import {
  checkDescribing,
  type DescribingValues,
  MAX_BATCH_SIZE,
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

function textInput(placeholder: string, name: string): HTMLInputElement {
  const node = document.createElement("input");

  node.type = "text";
  node.name = name;
  node.placeholder = placeholder;
  node.spellcheck = false;
  node.autocomplete = "off";

  return node;
}

function numberInput(name: string): HTMLInputElement {
  const node = document.createElement("input");

  node.type = "number";
  node.name = name;
  node.min = "1";
  node.max = String(MAX_BATCH_SIZE);
  node.step = "1";

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
  const batchSize = numberInput("batch_size");
  const error = document.createElement("p");
  const buttons = document.createElement("div");
  const saveButton = document.createElement("button");
  const cancelButton = document.createElement("button");

  describing.className = "describing";
  describingLegend.textContent = "Describing";
  describingRow.className = "describing-fields";
  describingRow.append(field("Model", model), field("Batch size", batchSize));
  describing.append(describingLegend, describingRow, hintNode(DESCRIBING_HINT));
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

    const checked = checkDescribing(model.value, batchSize.value);

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
    },
    showError(text) {
      error.textContent = text;
    },
  };
}
