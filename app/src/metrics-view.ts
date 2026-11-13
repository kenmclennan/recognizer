import { el } from "./dom";
import { fullMetricName } from "./inspector-model";
import { rangeLabel } from "./metric-bars";
import {
  groupHeader,
  type MetricDescriptor,
  type ModuleValue,
  type OverlayGroup,
} from "./overlay-model";
import { buildCheckbox, setCheckState } from "./row-view";

export type CanvasMetrics = {
  groups: readonly OverlayGroup[];
  now: number;
  ticked: readonly MetricDescriptor[];
  valueOf: (metric: MetricDescriptor, boxId: string) => ModuleValue | null;
};

export type MetricsView = {
  element: HTMLElement;
  render: (open: boolean, metrics: CanvasMetrics | null) => void;
  refreshAges: (metrics: CanvasMetrics) => void;
};

function row(
  metric: MetricDescriptor,
  position: number,
  enabled: boolean,
  toggle: (key: string) => void,
): HTMLElement {
  const node = el("div", "metric-row");
  const ticked = position >= 0;
  const checkbox = buildCheckbox(
    metric.title,
    ticked ? "checked" : "unchecked",
    () => {
      if (enabled) {
        toggle(metric.key);
      }
    },
  );
  const text = el("div", "metric-text");
  const head = el("div", "metric-head");

  node.dataset.metric = metric.key;
  setCheckState(checkbox, ticked ? "checked" : "unchecked");

  if (!enabled) {
    checkbox.setAttribute("aria-disabled", "true");
    checkbox.tabIndex = -1;
    node.classList.add("disabled");
  }

  const label = el("span", "metric-label", metric.title);
  const full = fullMetricName(metric);

  if (full !== metric.title) {
    label.title = full;
  }

  head.append(label);

  text.append(head);

  if (metric.description !== undefined) {
    text.append(el("div", "metric-description", metric.description));
  }

  if (ticked) {
    text.append(
      el("div", "metric-detail", `bar ${position + 1} - ${rangeLabel(metric)}`),
    );
  }

  node.addEventListener("click", (event) => {
    if (event.target !== checkbox && enabled) {
      event.stopPropagation();
      toggle(metric.key);
    }
  });
  node.append(checkbox, text);

  return node;
}

function groupHead(group: OverlayGroup, now: number): HTMLElement {
  const head = el("h4", "metric-group");
  const title = el("span", "metric-group-title", group.title);
  const age = el("span", "metric-group-age", groupHeader(group, now));

  if (group.tooltip !== "") {
    head.title = group.tooltip;
  }

  head.append(title, age);

  return head;
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
          groupHead(group, metrics?.now ?? Date.now()),
          ...group.notes.map((note) =>
            el("div", `metric-note ${note.tone}`, note.text),
          ),
          ...group.metrics.map((metric) =>
            row(metric, ticks.indexOf(metric.key), group.enabled, toggle),
          ),
        ]),
      );
    },
    refreshAges(metrics) {
      const ages = element.querySelectorAll(".metric-group-age");

      if (ages.length !== metrics.groups.length) {
        return;
      }

      metrics.groups.forEach((group, index) => {
        const text = groupHeader(group, metrics.now);
        const age = ages[index];

        if (age !== undefined && age.textContent !== text) {
          age.textContent = text;
        }
      });
    },
  };
}
