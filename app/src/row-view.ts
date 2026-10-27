import { el } from "./dom";
import type { Disc } from "./health";
import { icon } from "./icons";
import type { CheckState } from "./row-model";

export type RowSpec = {
  label: string;
  state: CheckState;
  bold: boolean;
  disc: Disc;
  discHover?: string;
  chevron?: "open" | "closed";
  detail?: { text: string; tone?: "private" | "inferred" };
  onCheck: () => void;
  onName: () => void;
  onChevron?: () => void;
};

const ARIA: Record<CheckState, string> = {
  checked: "true",
  partial: "mixed",
  unchecked: "false",
};

export function setCheckState(node: HTMLElement, state: CheckState): void {
  node.className = `rcheck ${state}`;
  node.setAttribute("aria-checked", ARIA[state]);
}

export function buildCheckbox(
  label: string,
  state: CheckState,
  onCheck: () => void,
): HTMLElement {
  const node = el("span");

  setCheckState(node, state);
  node.setAttribute("role", "checkbox");
  node.setAttribute("aria-label", label);
  node.tabIndex = 0;
  node.addEventListener("click", (event) => {
    event.stopPropagation();
    onCheck();
  });
  node.addEventListener("keydown", (event) => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      onCheck();
    }
  });

  return node;
}

export function buildRow(spec: RowSpec): HTMLElement {
  const node = el("div", `row${spec.bold ? " on" : ""}`);
  const disc = el("span", `disc disc-${spec.disc}`);

  disc.title = spec.discHover ?? "";

  if (spec.chevron) {
    const chevron = icon(
      spec.chevron === "open" ? "chevron-down" : "chevron-right",
      "chevron",
    );

    chevron.addEventListener("click", (event) => {
      event.stopPropagation();
      (spec.onChevron ?? spec.onName)();
    });
    node.append(chevron);
  }

  node.append(
    buildCheckbox(spec.label, spec.state, spec.onCheck),
    el("span", "name", spec.label),
    disc,
  );

  if (spec.detail) {
    node.append(
      el(
        "span",
        `detail${spec.detail.tone ? ` ${spec.detail.tone}` : ""}`,
        spec.detail.text,
      ),
    );
  }

  node.addEventListener("click", () => spec.onName());

  return node;
}
