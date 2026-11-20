export const SHOW_PRIVATE_KEY = "recognizer.show-private";

export function loadShowPrivate(storage: Pick<Storage, "getItem">): boolean {
  try {
    return storage.getItem(SHOW_PRIVATE_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveShowPrivate(
  storage: Pick<Storage, "setItem">,
  on: boolean,
): void {
  try {
    storage.setItem(SHOW_PRIVATE_KEY, on ? "true" : "false");
  } catch {
    return;
  }
}
