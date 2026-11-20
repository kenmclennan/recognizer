import { el } from "./dom";
import { placeTip } from "./tip-placement";

type Open = {
  anchor: HTMLElement;
  node: HTMLElement;
  token: string;
  fill: (node: HTMLElement) => void;
};

type Attached = { token: string; fill: (node: HTMLElement) => void };

const attached = new WeakMap<HTMLElement, Attached>();

let open: Open | null = null;
let observer: MutationObserver | null = null;

export function closeHoverTip(): void {
  open?.node.remove();
  open = null;
  observer?.disconnect();
  observer = null;
}

function position(anchor: HTMLElement, node: HTMLElement): void {
  const box = anchor.getBoundingClientRect();
  const at = placeTip(
    { left: box.left, top: box.top, width: box.width, height: box.height },
    { width: node.offsetWidth, height: node.offsetHeight },
    { width: window.innerWidth, height: window.innerHeight },
  );

  node.style.left = `${at.left}px`;
  node.style.top = `${at.top}px`;
}

function replacement(token: string): HTMLElement | null {
  const candidates = [
    ...document.body.querySelectorAll<HTMLElement>("[data-hover-key]"),
  ].filter((candidate) => candidate.dataset.hoverKey === token);
  const hovered = candidates.find((candidate) => candidate.matches(":hover"));

  if (hovered !== undefined) {
    return hovered;
  }

  return candidates.length === 1 ? candidates[0] : null;
}

function follow(): void {
  if (open === null || open.anchor.isConnected) {
    return;
  }

  const next = replacement(open.token);
  const entry = next === null ? undefined : attached.get(next);

  if (next === null || entry === undefined) {
    closeHoverTip();

    return;
  }

  open.anchor = next;
  open.fill = entry.fill;
  open.node.replaceChildren();
  entry.fill(open.node);
  position(next, open.node);
}

export function openHoverTip(
  anchor: HTMLElement,
  className: string,
  key: string,
  fill: (node: HTMLElement) => void,
): void {
  if (open?.anchor === anchor) {
    return;
  }

  closeHoverTip();

  const node = el("div", className);

  node.style.pointerEvents = "none";
  fill(node);
  document.body.append(node);
  position(anchor, node);
  open = { anchor, node, token: `${className}:${key}`, fill };
  observer = new MutationObserver(follow);
  observer.observe(document.body, { childList: true, subtree: true });
}

export function attachHoverTip(
  anchor: HTMLElement,
  className: string,
  fill: (node: HTMLElement) => void,
  key: string,
): void {
  const token = `${className}:${key}`;
  const close = () => {
    if (open?.anchor === anchor) {
      closeHoverTip();
    }
  };

  attached.set(anchor, { token, fill });
  anchor.dataset.hoverKey = token;
  anchor.addEventListener("mouseenter", () =>
    openHoverTip(anchor, className, key, fill),
  );
  anchor.addEventListener("mouseleave", close);
  anchor.addEventListener("pointerdown", close);
}
