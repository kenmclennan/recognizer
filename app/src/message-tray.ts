export type MessageKind = "warning" | "error" | "done" | "info";

export type MessageAction = {
  label: "Upgrade" | "Show" | "Undo" | "Open log" | "Update";
  run: () => void;
};

export type MessageInput = {
  kind: MessageKind;
  text: string;
  key?: string;
  onOpen?: boolean;
  action?: MessageAction;
  extra?: MessageAction;
};

export type CancelTimer = () => void;

export type SetTimer = (run: () => void, ms: number) => CancelTimer;

export const realTimer: SetTimer = (run, ms) => {
  const id = setTimeout(run, ms);

  return () => clearTimeout(id);
};

export const TOAST_MS = 3500;

export type MessageRow = {
  id: number;
  kind: MessageKind;
  text: string;
  when: string;
  action: string | null;
  extra: string | null;
  unread: boolean;
};

export type Badge = {
  count: number;
  tone: "amber" | "grey";
  hidden: boolean;
};

export type TraySnapshot = {
  rows: MessageRow[];
  badge: Badge;
  trayOpen: boolean;
  toast: MessageRow | null;
};

export type MessageTray = {
  post: (input: MessageInput) => number | null;
  withdraw: (id: number) => void;
  relabel: (id: number, label: string) => void;
  reconcile: (foundKeys: readonly string[]) => void;
  attach: (id: number, extra: MessageAction) => void;
  act: (id: number, slot?: "extra") => void;
  open: () => void;
  close: () => void;
  clear: () => void;
  subscribe: (listener: () => void) => () => void;
  snapshot: () => TraySnapshot;
};

type Held = {
  id: number;
  kind: MessageKind;
  text: string;
  key: string | undefined;
  onOpen: boolean;
  action: { label: string; run: () => void } | null;
  extra: MessageAction | null;
  postedAt: number;
  read: boolean;
};

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function timeLabel(age: number): string {
  if (age < MINUTE) {
    return "just now";
  }

  if (age < HOUR) {
    return `${Math.floor(age / MINUTE)} min ago`;
  }

  if (age < DAY) {
    return `${Math.floor(age / HOUR)} h ago`;
  }

  return `${Math.floor(age / DAY)} d ago`;
}

export function createMessageTray(
  clock: () => number,
  setTimer: SetTimer,
): MessageTray {
  let held: Held[] = [];
  let nextId = 1;
  let trayOpen = false;
  let drawnUnread = new Set<number>();
  let toastId: number | null = null;
  let cancelToast: CancelTimer | null = null;
  const listeners = new Set<() => void>();

  function changed() {
    for (const listener of [...listeners]) {
      listener();
    }
  }

  function hideToast() {
    cancelToast?.();
    cancelToast = null;
    toastId = null;
  }

  function showToast(id: number) {
    cancelToast?.();
    toastId = id;
    cancelToast = setTimer(() => {
      cancelToast = null;
      toastId = null;
      changed();
    }, TOAST_MS);
  }

  function rowOf(message: Held): MessageRow {
    return {
      id: message.id,
      kind: message.kind,
      text: message.text,
      when: message.onOpen ? "on open" : timeLabel(clock() - message.postedAt),
      action: message.action?.label ?? null,
      extra: message.extra?.label ?? null,
      unread: trayOpen ? drawnUnread.has(message.id) : !message.read,
    };
  }

  function find(id: number): Held | undefined {
    return held.find((message) => message.id === id);
  }

  return {
    post(input) {
      if (
        input.key !== undefined &&
        held.some((message) => message.key === input.key)
      ) {
        return null;
      }

      const message: Held = {
        id: nextId++,
        kind: input.kind,
        text: input.text,
        key: input.key,
        onOpen: input.onOpen === true,
        action: input.action === undefined ? null : { ...input.action },
        extra: input.extra === undefined ? null : { ...input.extra },
        postedAt: clock(),
        read: false,
      };

      held = [message, ...held];

      if (trayOpen) {
        drawnUnread.add(message.id);
      } else {
        showToast(message.id);
      }

      changed();

      return message.id;
    },
    withdraw(id) {
      const message = find(id);

      if (message !== undefined && message.action !== null) {
        message.action = null;
        changed();
      }
    },
    relabel(id, label) {
      const message = find(id);

      if (message !== undefined && message.action !== null) {
        message.action = { label, run: () => {} };
        changed();
      }
    },
    reconcile(foundKeys) {
      const found = new Set(foundKeys);
      const kept = held.filter(
        (message) => message.key === undefined || found.has(message.key),
      );

      if (kept.length === held.length) {
        return;
      }

      held = kept;

      if (toastId !== null && find(toastId) === undefined) {
        hideToast();
      }

      changed();
    },
    attach(id, extra) {
      const message = find(id);

      if (message !== undefined) {
        message.extra = { ...extra };
        changed();
      }
    },
    act(id, slot) {
      const message = find(id);
      const action = slot === "extra" ? message?.extra : message?.action;

      if (action === null || action === undefined) {
        return;
      }

      if (toastId === id) {
        hideToast();
      }

      action.run();
      changed();
    },
    open() {
      if (trayOpen) {
        return;
      }

      trayOpen = true;
      drawnUnread = new Set(
        held.filter((message) => !message.read).map((message) => message.id),
      );

      for (const message of held) {
        message.read = true;
      }

      hideToast();
      changed();
    },
    close() {
      if (!trayOpen) {
        return;
      }

      trayOpen = false;
      drawnUnread = new Set();

      for (const message of held) {
        message.read = true;
      }

      changed();
    },
    clear() {
      held = [];
      drawnUnread = new Set();
      hideToast();
      changed();
    },
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    snapshot() {
      const unread = held.filter((message) => !message.read);
      const toast = toastId === null ? undefined : find(toastId);

      return {
        rows: held.map(rowOf),
        badge: {
          count: unread.length > 0 ? unread.length : held.length,
          tone: unread.some(
            (message) => message.kind === "warning" || message.kind === "error",
          )
            ? "amber"
            : "grey",
          hidden: held.length === 0,
        },
        trayOpen,
        toast: toast === undefined ? null : rowOf(toast),
      };
    },
  };
}
