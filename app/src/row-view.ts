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

function checkbox(spec: RowSpec): HTMLElement {
  const node = el("span", `rcheck ${spec.state}`);

  node.setAttribute("role", "checkbox");
  node.setAttribute("aria-checked", ARIA[spec.state]);
  node.setAttribute("aria-label", spec.label);
  node.tabIndex = 0;
  node.addEventListener("click", (event) => {
    event.stopPropagation();
    spec.onCheck();
  });
  node.addEventListener("keydown", (event) => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      spec.onCheck();
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

  node.append(checkbox(spec), el("span", "name", spec.label), disc);

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
