import { getVersion } from "@tauri-apps/api/app";
import { APP_NAME } from "./app-info";
import { updateLabel } from "./update-label";
import type { UpdateState } from "./updater";

export type FooterView = {
  setUpdate: (state: UpdateState, run: () => void) => void;
  notify: (text: string) => void;
  setCount: (text: string) => void;
};

export function buildFooter(container: HTMLElement): FooterView {
  const identity = document.createElement("span");
  const count = document.createElement("span");
  const notice = document.createElement("span");
  const update = document.createElement("button");
  let updateRun: () => void = () => {};

  identity.className = "identity";
  identity.textContent = APP_NAME;
  count.className = "module-count";
  count.id = "module-count";
  notice.className = "notice";
  notice.setAttribute("role", "status");
  update.type = "button";
  update.className = "update-button";
  update.hidden = true;
  update.addEventListener("click", () => updateRun());
  container.replaceChildren(identity, count, notice, update);

  void getVersion().then((version) => {
    identity.textContent = `${APP_NAME} ${version}`;
  });

  return {
    setUpdate(state, run) {
      updateRun = run;
      update.hidden = state.kind === "none";
      update.disabled = state.kind === "installing";
      update.textContent = updateLabel(APP_NAME, state);
    },
    setCount(text) {
      count.textContent = text;
    },
    notify(text) {
      notice.textContent = text;
    },
  };
}
