export type SettingsValues = {
  editor: string;
  scanning: { describe: boolean; sensors: boolean };
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

export const SCANNING_HINT =
  "A repository the app has not scanned before scans with these phases ticked. After its first scan the Scan panel's ticks are remembered for it.";

function switchField(label: string, name: string): HTMLLabelElement {
  const node = document.createElement("label");
  const input = document.createElement("input");
  const text = document.createElement("span");

  node.className = "switch";
  input.type = "checkbox";
  input.name = name;
  text.textContent = label;
  node.append(input, text);

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
  const scanning = document.createElement("fieldset");
  const legend = document.createElement("legend");
  const describe = switchField("Descriptions", "describe");
  const sensors = switchField("Sensors", "sensors");
  const describeBox = describe.querySelector("input") as HTMLInputElement;
  const sensorsBox = sensors.querySelector("input") as HTMLInputElement;
  const error = document.createElement("p");
  const buttons = document.createElement("div");
  const saveButton = document.createElement("button");
  const cancelButton = document.createElement("button");

  scanning.className = "scanning";
  legend.textContent = "Scanning";
  scanning.append(legend, describe, sensors, hintNode(SCANNING_HINT));
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
    actions.save({
      editor: editor.value.trim(),
      scanning: { describe: describeBox.checked, sensors: sensorsBox.checked },
    });
  });

  form.append(
    field("Editor", editor),
    hintNode(EDITOR_HINT),
    scanning,
    error,
    buttons,
  );
  container.replaceChildren(form);

  return {
    fill(values) {
      editor.value = values.editor;
      describeBox.checked = values.scanning.describe;
      sensorsBox.checked = values.scanning.sensors;
    },
    showError(text) {
      error.textContent = text;
    },
  };
}
