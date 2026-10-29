export type SettingsValues = {
  editor: string;
  recognizerPath: string;
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
  "An app name such as Sublime Text, or a command for a GUI editor such as code or code --goto. Terminal editors are not supported.";

export const RECOGNIZER_HINT =
  "The recognizer command the app runs to scan. Leave blank for recognizer on your login shell's PATH; a path must be absolute.";

function field(label: string, control: HTMLElement): HTMLLabelElement {
  const node = document.createElement("label");
  const text = document.createElement("span");

  text.textContent = label;
  node.append(text, control);

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
  const recognizer = textInput("recognizer", "recognizerPath");
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
    actions.save({
      editor: editor.value.trim(),
      recognizerPath: recognizer.value.trim(),
    });
  });

  form.append(
    field("Editor", editor),
    hintNode(EDITOR_HINT),
    field("Recognizer command", recognizer),
    hintNode(RECOGNIZER_HINT),
    error,
    buttons,
  );
  container.replaceChildren(form);

  return {
    fill(values) {
      editor.value = values.editor;
      recognizer.value = values.recognizerPath;
    },
    showError(text) {
      error.textContent = text;
    },
  };
}
