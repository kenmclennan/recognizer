import {
  CORE_KEYS,
  type KeySchema,
  type PublishedKeys,
  parseKeySchema,
  publish,
  type Setting,
  type SettingsPane,
} from "recognizer";
import { configHash } from "./config-hash";
import { button, el } from "./dom";
import type { InstalledSensors, SensorInputs } from "./sensor-run";
import {
  createSettingsModel,
  type SettingsModel,
} from "./settings-modal-model";
import type { SettingsModalPort } from "./settings-modal-port";

export type SettingsModalDeps = {
  port: SettingsModalPort;
  sensors: {
    inputs(): Promise<SensorInputs>;
    sensorList?(): Promise<InstalledSensors>;
  };
  repository: boolean;
  onClose?: () => void;
};

export type SettingsModal = {
  element: HTMLElement;
  ready: Promise<void>;
  close(): void;
};

const MACHINE_WHERE = "Stored for this Mac; applies to every repository.";

const REPOSITORY_WHERE =
  "Saved in .recognizer/config.yaml; findings follow on your next scan.";

const RESET_ICON =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>';

const CHEVRON_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';

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
  reset: HTMLElement,
  info: string | undefined,
): HTMLElement {
  const node = el("div", "sm-field");
  const control = el("div", "sm-control");

  control.append(...controls);
  node.append(el("div", "sm-name", label), control, reset);

  if (info !== undefined) {
    node.setAttribute("title", info);
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
  let published: PublishedKeys = publish([CORE_KEYS], "config");
  let model: SettingsModel = createSettingsModel({
    panes: [],
    published,
    configText: null,
    machine: {},
    repository: deps.repository,
  });
  let configText: string | null = null;
  let current = "";
  let busy = false;
  let notice: string | null = null;
  let closed = false;
  let loaded = false;

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

  function renderNav(): void {
    nav.replaceChildren();

    const groups: [SettingsPane["group"], string][] = [
      ["machine", "This Mac"],
      ["repository", "This repository"],
    ];

    for (const [group, name] of groups) {
      const panes = model.panes().filter((one) => one.group === group);

      if (panes.length === 0) {
        continue;
      }

      nav.append(el("div", "sm-group", name));

      for (const one of panes) {
        const entry = button(one.name, "sm-entry", () => {
          current = one.id;
          notice = null;
          renderAll();
        });

        entry.classList.toggle("on", one.id === current);
        entry.classList.toggle("changed", model.paneChanged(one.id));
        entry.dataset.section = one.id;
        entry.append(el("span", "sm-dot"));
        nav.append(entry);
      }
    }
  }

  function renderFooter(): void {
    const refused = model.hasErrors();
    const count = model.count();
    const unsaved = model.dirty();

    save.disabled = busy || refused || !unsaved || !loaded;
    cancel.disabled = busy;
    message.classList.toggle("bad", refused || notice !== null);

    if (refused || notice !== null) {
      message.setAttribute("role", "alert");
    } else {
      message.removeAttribute("role");
    }

    message.replaceChildren();

    const first = model.firstError();

    if (notice !== null) {
      message.textContent = notice;
    } else if (first !== null) {
      message.textContent = `Fix the value marked in red to save: ${first.reason}`;
    } else if (unsaved) {
      const counted = Math.max(count, 1);

      message.append(
        el(
          "b",
          "",
          `${counted} unsaved ${counted === 1 ? "change" : "changes"}.`,
        ),
        document.createTextNode(
          model.repositoryDirty()
            ? " Repository changes take effect on your next scan."
            : "",
        ),
      );
    } else {
      message.textContent = "No changes.";
    }
  }

  function resetButton(field: Setting, visible: boolean): HTMLElement {
    const node = el("button", "sm-reset");

    node.type = "button";
    node.innerHTML = RESET_ICON;

    if (visible) {
      node.title = model.resetTitle(field);
      node.addEventListener("click", () => {
        model.resetField(field);
        renderAll();
      });
    } else {
      node.tabIndex = -1;
      node.disabled = true;
      node.setAttribute("aria-hidden", "true");
    }

    return node;
  }

  function plainOn(key: string): boolean {
    const raw = model.value(key);

    if (raw !== null) {
      return raw === "true";
    }

    const shown = model.defaultShown(key);

    return shown.kind === "figure" && shown.text === "on";
  }

  function switchButton(
    key: string,
    on: boolean,
    flip: () => void,
  ): HTMLButtonElement {
    const node = el("button", "sm-switch");

    node.type = "button";
    node.setAttribute("role", "switch");
    node.setAttribute("aria-checked", String(on));
    node.dataset.key = key;
    node.addEventListener("click", () => {
      flip();
      renderAll();
    });

    return node;
  }

  function controlFor(field: Setting, marked: boolean): HTMLElement[] {
    const key = field.key;
    const refused = model.error(key) !== null;
    const isChanged = marked && model.changed(field);
    const unit =
      field.unit === undefined ? [] : [el("span", "sm-unit", field.unit)];

    if (field.type === "boolean" && !model.hasSwitch(field)) {
      return [
        switchButton(key, plainOn(key), () =>
          model.stage(key, plainOn(key) ? "false" : "true"),
        ),
      ];
    }

    if (field.type === "enum") {
      const select = el("select");

      select.dataset.key = key;

      const shownValue = model.shown(field);
      const values = field.values ?? [];

      if (!values.includes(shownValue)) {
        const blank = el("option", "", "");

        blank.value = "";
        blank.selected = true;
        select.append(blank);
      }

      for (const value of values) {
        const option = el("option", "", value);

        option.selected = value === shownValue;
        select.append(option);
      }

      select.classList.toggle("changed", isChanged);
      select.addEventListener("change", () => {
        model.stage(key, select.value);
        renderAll();
      });

      return [select, ...unit];
    }

    const numeric = field.type === "integer" || field.type === "number";
    const text = input(numeric ? "num" : "", model.shown(field), key);
    const placeholder = model.defaultShown(key);

    if (placeholder.kind === "text") {
      const split = placeholder.text.indexOf(": ");

      text.placeholder =
        split < 0 ? placeholder.text : placeholder.text.slice(0, split);
      text.classList.add("hinted");
    }

    text.dataset.key = key;
    text.disabled = model.hasSwitch(field) && !model.isOn(field);
    text.classList.toggle("changed", isChanged);
    text.classList.toggle("refused", refused);
    const onTyped = () => {
      model.stage(key, text.value);
      text.classList.toggle("changed", marked && model.changed(field));
      text.classList.toggle("refused", model.error(key) !== null);
      text
        .closest(".sm-field")
        ?.classList.toggle("changed", marked && model.changed(field));
      renderNav();
      renderFooter();
    };

    text.addEventListener("input", onTyped);
    text.addEventListener("change", onTyped);

    if (!model.hasSwitch(field)) {
      return [text, ...unit];
    }

    return [
      switchButton(key, model.isOn(field), () => model.toggle(field)),
      text,
      ...unit,
    ];
  }

  function fieldRow(field: Setting, resettable = true): HTMLElement {
    const toggleOnly = field.type === "boolean" && !model.hasSwitch(field);
    const node = row(
      field.label ?? field.key,
      controlFor(field, resettable),
      resetButton(field, resettable && !toggleOnly),
      field.description,
    );

    node.classList.toggle(
      "changed",
      resettable && !toggleOnly && model.changed(field),
    );

    return node;
  }

  function settingsPane(one: SettingsPane): void {
    pane.append(
      el("h2", "", one.name),
      el(
        "div",
        "sm-where",
        one.group === "machine" ? MACHINE_WHERE : REPOSITORY_WHERE,
      ),
    );

    for (const section of one.sections) {
      if (section.title !== null) {
        pane.append(el("h3", "sm-section", section.title));
      }

      pane.append(...section.settings.map((field) => fieldRow(field)));
    }
  }

  function suiteCard(name: string): HTMLElement {
    const card = el("details", "sm-suite");
    const head = el("summary", "sm-card-head");
    const chevron = el("span", "sm-chev");
    const meta = [
      model.suiteValue(name, "language"),
      model.suiteValue(name, "directory"),
    ]
      .filter((part) => part !== "")
      .join(" · ");

    chevron.innerHTML = CHEVRON_ICON;
    head.append(
      chevron,
      el("span", "sm-suite-name", name),
      el("span", "sm-meta", meta),
    );
    card.append(head);

    const inner = el("div", "sm-inner");

    for (const suiteRow of model.suiteRows(name)) {
      inner.append(
        fieldRow(
          { ...suiteRow.setting, key: suiteRow.key, label: suiteRow.label },
          false,
        ),
      );
    }

    card.append(inner);

    return card;
  }

  function suitesPane(one: SettingsPane): void {
    pane.append(
      el("h2", "", one.name),
      el("div", "sm-where", REPOSITORY_WHERE),
    );

    for (const name of model.suites()) {
      pane.append(suiteCard(name));
    }

    const adder = el("div", "sm-adder");
    const name = input("", "", "suite-name", "suite name");
    const add = button("Add a test suite", "sm-add", () => {
      const problem = model.addSuite(name.value.trim());

      notice = problem;
      renderAll();
    });

    adder.append(name, add);
    pane.append(adder);
  }

  function renderAll(): void {
    pane.replaceChildren();

    const panes = model.panes();

    if (!loaded) {
      pane.append(el("div", "sm-loading", "Loading settings..."));
      renderFooter();

      return;
    }

    if (!panes.some((one) => one.id === current)) {
      current = panes[0]?.id ?? "";
    }

    renderNav();

    const shown = panes.find((one) => one.id === current);

    if (shown !== undefined) {
      if (shown.suites !== undefined) {
        suitesPane(shown);
      } else {
        settingsPane(shown);
      }
    }

    renderFooter();
  }

  async function doSave(): Promise<void> {
    if (busy || model.hasErrors()) {
      return;
    }

    busy = true;
    notice = null;
    renderFooter();

    try {
      if (model.machineDirty()) {
        await deps.port.writeSettings(model.machineEdits());
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
            current = model.paneOfKey(written.key) ?? current;
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
      const [settings, panes] = await Promise.all([
        deps.port.readSettings(),
        deps.port.readPanes(),
      ]);

      if (panes.status !== "ok") {
        notice = panes.reason;
      }

      if (deps.repository) {
        const [keys, inputs] = await Promise.all([
          deps.port.readConfigKeys(),
          deps.sensors.inputs(),
        ]);
        const schemas: KeySchema[] = [CORE_KEYS];

        if (keys.status === "ok") {
          const parsed = parseKeySchema(JSON.stringify(keys.schema));

          if ("schema" in parsed) {
            schemas.push(parsed.schema);
          }
        }

        published = publish(schemas, "config");
        configText = inputs.configText;
      }

      model = createSettingsModel({
        panes: panes.status === "ok" ? panes.panes : [],
        published,
        configText,
        machine: settings.values,
        repository: deps.repository,
      });
    } catch (error) {
      notice = error instanceof Error ? error.message : String(error);
    }

    loaded = true;

    if (!closed) {
      renderAll();
    }
  })();

  return { element: scrim, ready, close };
}
