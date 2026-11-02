import { el } from "./dom";
import { rangeLabel } from "./metric-bars";
import type {
  MetricDescriptor,
  ModuleValue,
  OverlayGroup,
} from "./overlay-model";
import { buildCheckbox, setCheckState } from "./row-view";

export type CanvasMetrics = {
  groups: readonly OverlayGroup[];
  ticked: readonly MetricDescriptor[];
  valueOf: (metric: MetricDescriptor, boxId: string) => ModuleValue | null;
};

export type MetricsView = {
  element: HTMLElement;
  render: (open: boolean, metrics: CanvasMetrics | null) => void;
};

function row(
  metric: MetricDescriptor,
  position: number,
  toggle: (key: string) => void,
): HTMLElement {
  const node = el("div", "metric-row");
  const ticked = position >= 0;
  const checkbox = buildCheckbox(
    metric.label,
    ticked ? "checked" : "unchecked",
    () => {
      if (!metric.stale) {
        toggle(metric.key);
      }
    },
  );
  const text = el("div", "metric-text");
  const head = el("div", "metric-head");

  node.dataset.metric = metric.key;
  node.classList.toggle("stale", metric.stale);
  setCheckState(checkbox, ticked ? "checked" : "unchecked");

  if (metric.stale) {
    checkbox.setAttribute("aria-disabled", "true");
    checkbox.tabIndex = -1;
    node.classList.add("disabled");
  }

  head.append(el("span", "metric-label", metric.label));

  if (metric.stale) {
    head.append(el("span", "metric-chip", "stale"));
  }

  text.append(head);

  if (metric.description !== undefined) {
    text.append(el("div", "metric-description", metric.description));
  }

  text.append(el("div", "metric-granularity", `per ${metric.granularity}`));

  if (ticked) {
    text.append(
      el("div", "metric-detail", `bar ${position + 1} - ${rangeLabel(metric)}`),
    );
  }

  node.addEventListener("click", (event) => {
    if (event.target !== checkbox && !metric.stale) {
      event.stopPropagation();
      toggle(metric.key);
    }
  });
  node.append(checkbox, text);

  return node;
}

export function buildMetricsView(toggle: (key: string) => void): MetricsView {
  const element = el("div", "canvas-metrics");

  element.hidden = true;
  element.addEventListener("pointerdown", (event) => event.stopPropagation());
  element.addEventListener("click", (event) => event.stopPropagation());

  return {
    element,
    render(open, metrics) {
      element.hidden = !open;

      if (!open) {
        return;
      }

      const groups = metrics?.groups ?? [];

      if (groups.length === 0) {
        element.replaceChildren(
          el("p", "metrics-empty", "No overlays were found."),
        );

        return;
      }

      const ticks = (metrics?.ticked ?? []).map((metric) => metric.key);

      element.replaceChildren(
        ...groups.flatMap((group) => [
          el("h4", "metric-group", group.heading),
          ...group.metrics.map((metric) =>
            row(metric, ticks.indexOf(metric.key), toggle),
          ),
        ]),
      );
    },
  };
}
