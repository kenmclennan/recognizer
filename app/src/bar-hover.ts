export const BAR_HIDE_DELAY_MS = 300;

export type Scheduler<Handle = unknown> = {
  after: (fn: () => void, ms: number) => Handle;
  cancel: (handle: Handle) => void;
};

export type BarHover = {
  enter: () => void;
  leave: () => void;
  reset: () => void;
  visible: () => boolean;
};

export const timerScheduler: Scheduler = {
  after: (fn, ms) => setTimeout(fn, ms),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createBarHover(
  scheduler: Scheduler,
  onChange: (visible: boolean) => void,
): BarHover {
  let visible = false;
  let pending: unknown = null;
  let waiting = false;

  const set = (next: boolean) => {
    if (next !== visible) {
      visible = next;
      onChange(visible);
    }
  };
  const cancelPending = () => {
    if (waiting) {
      scheduler.cancel(pending);
      waiting = false;
      pending = null;
    }
  };

  return {
    enter() {
      cancelPending();
      set(true);
    },
    leave() {
      if (waiting || !visible) {
        return;
      }

      waiting = true;
      pending = scheduler.after(() => {
        waiting = false;
        pending = null;
        set(false);
      }, BAR_HIDE_DELAY_MS);
    },
    reset() {
      cancelPending();
      set(false);
    },
    visible: () => visible,
  };
}
