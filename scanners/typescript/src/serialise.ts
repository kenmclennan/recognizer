import type { ScanDocument } from "./scan.js";

export function render(document: ScanDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
