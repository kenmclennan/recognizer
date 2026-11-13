import {
  CORE_KEYS,
  type KeySchema,
  type PublishedKeys,
  parseKeySchema,
  publish,
} from "recognizer";
import { configHash } from "./config-hash";
import { button, el } from "./dom";
import type { SensorInputs, ShippedSensors } from "./sensor-run";
import {
  checkDescribing,
  createRepositoryModel,
  type FieldSpec,
  fieldKeys,
  MAX_BATCH_SIZE,
  MAX_CONFIRM_ABOVE_USD,
  type RepositoryModel,
  repositorySections,
  SECTION_SPECS,
  type SectionId,
  SUITE_FIELDS,
} from "./settings-modal-model";
import type { Settings, SettingsModalPort } from "./settings-modal-port";

export type SettingsModalDeps = {
  port: SettingsModalPort;
  sensors: {
    readInputs(): Promise<SensorInputs>;
    shipped(): Promise<ShippedSensors>;
  };
  repository: boolean;
  onClose?: () => void;
};

export type SettingsModal = {
  element: HTMLElement;
  ready: Promise<void>;
  close(): void;
};

type PaneId = "editor" | "describing" | SectionId;

type AppValues = {
  editor: string;
  model: string;
  batchSize: string;
  confirmAbove: string;
};

const APP_ENTRIES: { id: PaneId; name: string }[] = [
  { id: "editor", name: "Editor" },
  { id: "describing", name: "Describing" },
];

export const EDITOR_INFO =
  "An app name such as Sublime Text, or a command such as code -g {file}:{line}. Without {file} and {line} the file opens at the top. Terminal editors are not supported.";

export const MODEL_INFO =
  "The model every description uses, for scans started from the app and from a terminal.";

export const CONFIRM_INFO =
  "A scan asks before describing when its estimated cost, at API prices, is above this.";

function appValuesOf(settings: Settings): AppValues {
  return {
    editor: settings.editor,
    model: settings.describing.model,
    batchSize: String(settings.describing.batchSize),
    confirmAbove: settings.describing.confirmAboveUsd.toFixed(2),
  };
}

function input(
  className: string,
  value: string,
  name: string,
  placeholder = "",
): HTMLInputElement {
  const node = el("input", className);

  node.type = "text";
  node.name = name;
  node.value = value;
  node.placeholder = placeholder;
  node.spellcheck = false;
  node.autocomplete = "off";

  return node;
}

function row(
  label: string,
  controls: HTMLElement[],
  trailing: HTMLElement | null,
  error: string | null,
): HTMLElement {
  const node = el("div", "sm-field");
  const control = el("div", "sm-control");

  control.append(...controls);
  node.append(el("div", "sm-name", label), control, trailing ?? el("span"));

  if (error !== null) {
    const line = el("p", "sm-error", error);

    line.setAttribute("role", "alert");
    node.append(line);
  }

  return node;
}

export function openSettingsModal(deps: SettingsModalDeps): SettingsModal {
  const scrim = el("div", "settings-scrim");
  const modal = el("div", "settings-modal");
  const nav = el("nav", "sm-nav");
  const pane = el("div", "sm-pane");
  const message = el("span", "sm-message");
  const cancel = button("Cancel", "", () => close());
  const save = button("Save", "primary", () => void doSave());
  let loaded: AppValues = appValuesOf({
    editor: "",
    describing: { model: "", batchSize: 1, confirmAboveUsd: 0 },
  });
  let app = { ...loaded };
  let published: PublishedKeys = publish([CORE_KEYS], "config");
  let model: RepositoryModel = createRepositoryModel(published, null);
  let sections: { id: SectionId; name: string }[] = [];
  let configText: string | null = null;
  let current: PaneId = "editor";
  let busy = false;
  let notice: string | null = null;
  let appError: string | null = null;
  let closed = false;

  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "Settings");
  modal.append(
    el("div", "sm-head", "Settings"),
    nav,
    pane,
    (() => {
      const foot = el("div", "sm-foot");

      foot.append(message, cancel, save);

      return foot;
    })(),
  );
  scrim.append(modal);

  const appChanged = () =>
    app.editor !== loaded.editor ||
    app.model !== loaded.model ||
    app.batchSize !== loaded.batchSize ||
    app.confirmAbove !== loaded.confirmAbove;

  const checked = () =>
    checkDescribing(app.model, app.batchSize, app.confirmAbove);

  function renderNav(): void {
    nav.replaceChildren();

    const group = (name: string, where: string) => {
      const head = el("div", "sm-group", name);

      head.append(el("span", "", where));
      nav.append(head);
    };
    const entry = (id: PaneId, name: string, changed: boolean) => {
      const one = button(name, "sm-entry", () => {
        current = id;
        notice = null;
        renderAll();
      });

      one.classList.toggle("on", id === current);
      one.classList.toggle("changed", changed);
      one.dataset.section = id;
      one.append(el("span", "sm-dot"));
      nav.append(one);
    };

    group("App", "this Mac");

    for (const one of APP_ENTRIES) {
      entry(one.id, one.name, false);
    }

    if (!deps.repository) {
      return;
    }

    group("Repository", ".recognizer/config.yaml");

    for (const one of sections) {
      entry(one.id, one.name, model.sectionChanged(one.id));
    }
  }

  function renderFooter(): void {
    const refused = model.hasErrors() || (appError !== null && appChanged());
    const edits = model.edits().length;

    save.disabled = busy || refused || (!appChanged() && edits === 0);
    cancel.disabled = busy;
    message.classList.toggle("bad", refused || notice !== null);

    if (notice !== null) {
      message.textContent = notice;
    } else if (refused) {
      message.textContent = "Fix the value marked in red to save.";
    } else if (appChanged() || edits > 0) {
      message.textContent =
        edits > 0
          ? "Unsaved changes. Findings follow on your next scan."
          : "Unsaved changes.";
    } else {
      message.textContent = "";
    }
  }

  function title(name: string, where: string, reset: HTMLElement | null) {
    const head = el("div", "sm-title");

    head.append(el("h2", "", name));

    if (reset !== null) {
      head.append(reset);
    }

    return [head, el("div", "sm-where", where)];
  }

  function appPane(id: "editor" | "describing"): void {
    const where = "Stored for this Mac; applies to every repository.";
    const card = el("div", "sm-card");

    if (id === "editor") {
      const editor = input("", app.editor, "editor", "System default");

      editor.addEventListener("input", () => {
        app.editor = editor.value.trim();
        renderFooter();
      });
      card.append(
        row(
          "Open files in",
          [editor],
          el("span", "sm-unit", "App or command"),
          null,
        ),
      );
      card.setAttribute("title", EDITOR_INFO);
    } else {
      const model_ = input("", app.model, "model", "haiku");
      const batch = input("num", app.batchSize, "batch_size");
      const ask = input("num", app.confirmAbove, "confirm_above_usd");
      const error = () => {
        const result = checked();

        appError = result.ok ? null : result.error;
        renderFooter();
        refreshAppError();
      };

      model_.addEventListener("input", () => {
        app.model = model_.value;
        error();
      });
      batch.addEventListener("input", () => {
        app.batchSize = batch.value;
        error();
      });
      ask.addEventListener("input", () => {
        app.confirmAbove = ask.value;
        error();
      });
      card.append(
        row("Model", [model_], null, null),
        row(
          "Batch size",
          [
            batch,
            el("span", "sm-unit", `modules at a time (1 to ${MAX_BATCH_SIZE})`),
          ],
          null,
          null,
        ),
        row(
          "Ask above",
          [
            ask,
            el(
              "span",
              "sm-unit",
              `USD per scan (0 to ${MAX_CONFIRM_ABOVE_USD})`,
            ),
          ],
          null,
          null,
        ),
      );
      card.setAttribute("title", `${MODEL_INFO} ${CONFIRM_INFO}`);
    }

    const alert = el("p", "sm-error");

    alert.id = "sm-app-error";
    alert.setAttribute("role", "alert");
    alert.textContent = appError ?? "";
    pane.append(
      ...title(id === "editor" ? "Editor" : "Describing", where, null),
      card,
      alert,
    );
  }

  function refreshAppError(): void {
    const alert = pane.querySelector("#sm-app-error");

    if (alert !== null) {
      alert.textContent = appError ?? "";
    }
  }

  function defaultCell(keys: string[]): HTMLElement | null {
    const parts: HTMLElement[] = [];

    for (const key of keys) {
      const shown = model.defaultShown(key);
      const isChanged = model.changed(key);

      if (shown.kind === "text" || (shown.kind === "figure" && isChanged)) {
        parts.push(el("span", "", `default ${shown.text}`));
      }

      if (isChanged) {
        parts.push(
          button("Reset", "sm-link", () => {
            model.reset([key]);
            renderAll();
          }),
        );
      }
    }

    if (parts.length === 0) {
      return null;
    }

    const cell = el("span", "sm-default");

    cell.append(...parts);

    return cell;
  }

  function isOn(key: string): boolean {
    const raw = model.value(key);

    if (raw !== null) {
      return raw === "true";
    }

    const shown = model.defaultShown(key);

    return shown.kind === "figure" && shown.text === "on";
  }

  function switchFor(key: string): HTMLButtonElement {
    const on = isOn(key);
    const node = el("button", "sm-switch");

    node.type = "button";
    node.setAttribute("role", "switch");
    node.setAttribute("aria-checked", String(on));
    node.dataset.key = key;
    node.addEventListener("click", () => {
      model.stage(key, on ? "false" : "true");
      renderAll();
    });

    return node;
  }

  function selectFor(key: string): HTMLSelectElement {
    const entry = model.entryOf(key);
    const node = el("select");

    node.dataset.key = key;

    const raw = model.value(key);
    const shown = model.defaultShown(key);
    const effective = raw ?? (shown.kind === "figure" ? shown.text : "");

    for (const value of entry?.values ?? []) {
      const option = el("option", "", value);

      option.selected = value === effective;
      node.append(option);
    }

    node.classList.toggle("changed", model.changed(key));
    node.addEventListener("change", () => {
      model.stage(key, node.value);
      renderAll();
    });

    return node;
  }

  function numberFor(key: string, disabled = false): HTMLInputElement {
    const raw = model.value(key);
    const shown = model.defaultShown(key);
    const value = raw ?? (shown.kind === "figure" ? shown.text : "");
    const node = input("num", value, key);

    node.dataset.key = key;
    node.disabled = disabled;
    node.classList.toggle("changed", model.changed(key));
    node.classList.toggle("refused", model.error(key) !== null);
    node.addEventListener("change", () => {
      model.stage(key, node.value);
      renderAll();
    });

    return node;
  }

  function fieldRow(field: FieldSpec): HTMLElement {
    const controls: HTMLElement[] = [];

    if (field.control === "switch") {
      controls.push(switchFor(field.key));
    } else if (field.control === "limit") {
      const on = field.switchKey === undefined ? true : isOn(field.switchKey);

      controls.push(numberFor(field.key, !on));

      if (field.unit !== undefined) {
        controls.push(el("span", "sm-unit", field.unit));
      }

      if (field.switchKey !== undefined) {
        controls.push(switchFor(field.switchKey));
      }
    } else {
      controls.push(numberFor(field.key));

      if (field.unit !== undefined) {
        controls.push(el("span", "sm-unit", field.unit));
      }
    }

    if (field.severityKey !== undefined) {
      controls.push(selectFor(field.severityKey));
    }

    const error = fieldKeys(field)
      .map((key) => model.error(key))
      .find((one) => one !== null);

    return row(
      field.label,
      controls,
      defaultCell(fieldKeys(field)),
      error ?? null,
    );
  }

  function repositoryPane(id: SectionId): void {
    const where =
      "Stored in this repository's .recognizer/config.yaml, committed with the code.";

    if (id === "suites") {
      suitesPane(where);

      return;
    }

    const spec = SECTION_SPECS.find((one) => one.id === id);

    if (spec === undefined) {
      return;
    }

    const reset = button("Reset section to defaults", "sm-link", () => {
      model.resetSection(id);
      renderAll();
    });

    reset.disabled = !model.sectionChanged(id);
    pane.append(...title(spec.name, where, reset));

    if (id === "structure" && model.structureOff()) {
      pane.append(
        el(
          "p",
          "sm-note",
          "The structure sensor is off (sensors.structure: off in the config).",
        ),
      );
    }

    const card = el("div", "sm-card");

    card.append(...spec.fields.map(fieldRow));
    pane.append(card);
  }

  function suiteField(name: string, suffix: string): HTMLElement {
    const key = `tests.${name}.${suffix}`;
    const entry = model.entryOf(key);
    const raw = model.value(key) ?? "";
    const control =
      entry?.type === "enum"
        ? (() => {
            const select = el("select");
            const blank = el("option", "", "");

            select.dataset.key = key;
            blank.value = "";
            select.append(blank);

            for (const value of entry.values ?? []) {
              const option = el("option", "", value);

              option.selected = value === raw;
              select.append(option);
            }

            select.addEventListener("change", () => {
              model.stageSuiteField(key, select.value);
              renderAll();
            });

            return select;
          })()
        : (() => {
            const text = input("", raw, key);

            text.dataset.key = key;
            text.classList.toggle("refused", model.error(key) !== null);
            text.addEventListener("change", () => {
              model.stageSuiteField(key, text.value);
              renderAll();
            });

            return text;
          })();

    return row(suffix, [control], defaultCell([key]), model.error(key));
  }

  function suitesPane(where: string): void {
    pane.append(...title("Test suites", where, null));

    for (const name of model.suites()) {
      const card = el("div", "sm-card");
      const head = el("div", "sm-card-head", name);
      const envKeys = model
        .suiteKeys(name)
        .filter((key) => key.startsWith(`tests.${name}.env.`));

      card.append(head);

      for (const suffix of SUITE_FIELDS) {
        card.append(suiteField(name, suffix));
      }

      for (const key of envKeys) {
        card.append(suiteField(name, key.slice(`tests.${name}.`.length)));
      }

      pane.append(card);
    }

    const adder = el("div", "sm-card-head");
    const name = input("", "", "suite-name", "suite name");
    const error = el("p", "sm-error");
    const add = button("+ Add a suite", "sm-add", () => {
      const problem = model.addSuite(name.value.trim());

      if (problem !== null) {
        error.textContent = problem;

        return;
      }

      renderAll();
    });

    adder.append(name, add);
    pane.append(adder, error);
  }

  function renderAll(): void {
    pane.replaceChildren();
    renderNav();

    if (current === "editor" || current === "describing") {
      appPane(current);
    } else {
      repositoryPane(current);
    }

    renderFooter();
  }

  function paneOfKey(key: string): PaneId {
    if (key.startsWith("tests.")) {
      return "suites";
    }

    for (const spec of SECTION_SPECS) {
      if (spec.fields.some((field) => fieldKeys(field).includes(key))) {
        return spec.id;
      }
    }

    return current;
  }

  async function doSave(): Promise<void> {
    if (busy) {
      return;
    }

    const result = checked();

    if (!result.ok) {
      appError = result.error;
      current = "describing";
      renderAll();

      return;
    }

    busy = true;
    notice = null;
    renderFooter();

    try {
      if (appChanged()) {
        await deps.port.writeSettings({
          editor: app.editor,
          describing: result.value,
        });
      }

      const edits = model.edits();

      if (edits.length > 0) {
        const written = await deps.port.writeRepositoryConfig(
          edits,
          await configHash(configText),
        );

        if (written.status === "refused") {
          if (written.key !== null) {
            model.refuse(written.key, written.reason);
            current = paneOfKey(written.key);
          } else {
            notice = written.reason;
          }

          busy = false;
          renderAll();

          return;
        }

        if (written.status !== "written") {
          notice =
            written.status === "changed"
              ? `${written.reason}; close Settings and open it again`
              : written.reason;
          busy = false;
          renderAll();

          return;
        }
      }

      busy = false;
      close();
    } catch (error) {
      busy = false;
      notice = error instanceof Error ? error.message : String(error);
      renderAll();
    }
  }

  function close(): void {
    if (closed) {
      return;
    }

    closed = true;
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
  document.body.append(scrim);
  renderAll();

  const ready = (async () => {
    try {
      const settings = await deps.port.readSettings();

      loaded = appValuesOf(settings);
      app = { ...loaded };

      if (deps.repository) {
        const [keys, inputs, shipped] = await Promise.all([
          deps.port.readConfigKeys(),
          deps.sensors.readInputs(),
          deps.sensors
            .shipped()
            .catch(
              (): ShippedSensors => ({ status: "unavailable", reason: "" }),
            ),
        ]);
        const schemas: KeySchema[] = [CORE_KEYS];

        if (keys.status === "ok") {
          const parsed = parseKeySchema(JSON.stringify(keys.schema));

          if ("schema" in parsed) {
            schemas.push(parsed.schema);
          }
        }

        published = publish(schemas, "config");
        configText = inputs.config;
        model = createRepositoryModel(published, configText);
        sections = repositorySections(
          shipped.status === "ok" ? shipped.sensors : [],
          published,
        );
      }
    } catch (error) {
      notice = error instanceof Error ? error.message : String(error);
    }

    if (!closed) {
      renderAll();
    }
  })();

  return { element: scrim, ready, close };
}
