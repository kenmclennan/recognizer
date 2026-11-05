import { el } from "./dom";
import { placeTip } from "./tip-placement";

type Open = { anchor: HTMLElement; node: HTMLElement };

let open: Open | null = null;
let observer: MutationObserver | null = null;

export function closeHoverTip(): void {
  open?.node.remove();
  open = null;
  observer?.disconnect();
  observer = null;
}

export function openHoverTip(
  anchor: HTMLElement,
  className: string,
  fill: (node: HTMLElement) => void,
): void {
  closeHoverTip();

  const node = el("div", className);

  node.style.pointerEvents = "none";
  fill(node);
  document.body.append(node);

  const box = anchor.getBoundingClientRect();
  const at = placeTip(
    { left: box.left, top: box.top, width: box.width, height: box.height },
    { width: node.offsetWidth, height: node.offsetHeight },
    { width: window.innerWidth, height: window.innerHeight },
  );

  node.style.left = `${at.left}px`;
  node.style.top = `${at.top}px`;
  open = { anchor, node };
  observer = new MutationObserver(() => {
    if (open !== null && !open.anchor.isConnected) {
      closeHoverTip();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

export function attachHoverTip(
  anchor: HTMLElement,
  className: string,
  fill: (node: HTMLElement) => void,
): void {
  const close = () => {
    if (open?.anchor === anchor) {
      closeHoverTip();
    }
  };

  anchor.addEventListener("mouseenter", () =>
    openHoverTip(anchor, className, fill),
  );
  anchor.addEventListener("mouseleave", close);
  anchor.addEventListener("pointerdown", close);
}
