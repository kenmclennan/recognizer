import { button, el } from "./dom";
import type { IndexedNote, NoteOrder } from "./notes-order";
import { tint } from "./notes-order";

export type NotesPanelProps = {
  hasView: boolean;
  order: NoteOrder;
  active: number | null;
  author: string;
  target: string | null;
  targetIsModule: boolean;
};

export type NotesPanelActions = {
  select: (index: number) => void;
  remove: (index: number) => void;
  add: (module: string, text: string) => void;
};

export type NotesPanelView = {
  element: HTMLElement;
  render: (props: NotesPanelProps) => void;
  focusComposer: () => void;
};

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function buildNotesPanelView(
  actions: NotesPanelActions,
): NotesPanelView {
  const element = el("div", "notes-panel");
  const header = el("div", "notes-header", "Notes");
  const composer = el("div", "note-composer");
  const prompt = el("p", "note-prompt");
  const label = el("div", "note-target");
  const field = el("textarea", "note-field");
  const add = button("Add", "note-add", () => submit());
  const list = el("div", "note-list");
  const drafts = new Map<string, string>();
  let props: NotesPanelProps | null = null;
  let shownTarget: string | null = null;

  field.rows = 3;
  field.setAttribute("aria-label", "Note");
  field.placeholder = "Add a note";
  add.disabled = true;
  composer.append(prompt, label, field, add);
  element.append(header, composer, list);

  function submit() {
    const target = props?.target;
    const text = field.value.trim();

    if (!props?.targetIsModule || target == null || text === "") {
      return;
    }

    drafts.delete(target);
    field.value = "";
    add.disabled = true;
    actions.add(target, text);
  }

  field.addEventListener("input", () => {
    add.disabled = field.value.trim() === "";

    if (shownTarget !== null) {
      drafts.set(shownTarget, field.value);
    }
  });
  field.addEventListener("keydown", (event) => {
    event.stopPropagation();

    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape") {
      event.preventDefault();

      if (shownTarget !== null) {
        drafts.delete(shownTarget);
      }

      field.value = "";
      add.disabled = true;
      field.blur();
    }
  });

  function row(entry: IndexedNote, author: string, off: boolean) {
    const { index, note } = entry;
    const node = el(
      "div",
      `note-row ${tint(note.by, author)}${off ? " off" : ""}${
        props?.active === index ? " active" : ""
      }`,
    );
    const remove = button("Remove", "note-remove", () => actions.remove(index));

    node.dataset.index = String(index);
    remove.setAttribute("aria-label", "Remove note");
    remove.title = "Remove note";
    remove.textContent = "×";
    node.append(
      el("span", "note-text", note.text),
      el("span", "note-by", `by ${note.by}`),
      remove,
    );

    if (!off) {
      node.addEventListener("click", () => actions.select(index));
    }

    return node;
  }

  function group(module: string, entries: IndexedNote[], author: string) {
    const node = el("section", "note-group");
    const heading = el("h3", "note-group-title");
    const dir = module.slice(0, module.length - fileName(module).length);

    node.dataset.module = module;
    heading.append(dir, el("strong", "", fileName(module)));
    node.append(heading, ...entries.map((entry) => row(entry, author, false)));

    return node;
  }

  return {
    element,
    focusComposer() {
      if (props?.targetIsModule) {
        field.focus();
      }
    },
    render(next) {
      props = next;

      if (!next.hasView) {
        prompt.textContent = "Open or save a view to add notes";
        prompt.hidden = false;
        label.hidden = true;
        field.hidden = true;
        add.hidden = true;
        list.replaceChildren();

        return;
      }

      const target = next.targetIsModule ? next.target : null;

      if (target !== shownTarget) {
        shownTarget = target;
        field.value = target === null ? "" : (drafts.get(target) ?? "");
        add.disabled = field.value.trim() === "";
      }

      prompt.hidden = target !== null;
      prompt.textContent = "Select a module to add a note";
      label.hidden = target === null;
      label.textContent = target ?? "";
      field.hidden = target === null;
      add.hidden = target === null;

      const parts: HTMLElement[] = next.order.groups.map((entry) =>
        group(entry.module, entry.entries, next.author),
      );

      if (next.order.off.length > 0) {
        const off = el("section", "note-off");

        off.append(
          el("h3", "note-group-title", "Not on the canvas"),
          ...next.order.off.map((entry) => row(entry, next.author, true)),
        );
        parts.push(off);
      }

      list.replaceChildren(...parts);
    },
  };
}
