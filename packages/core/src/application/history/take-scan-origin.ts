import type { WindowBaselines } from "../../domain/history/window-baselines.js";
import type { Git } from "../shared/ports/git.js";

export function takeScanOrigin(
  ports: { readonly git: Git },
  windows: WindowBaselines,
  window: string,
  root: string,
): null {
  const inside = ports.git.insideWorkTree(root);

  windows.entry(window).origin = {
    branch: inside ? ports.git.branch(root) : null,
    commit: inside ? ports.git.commit(root) : null,
  };

  return null;
}
