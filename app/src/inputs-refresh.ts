export type InputsRefresh = {
  refresh: () => Promise<unknown>;
  doctor: () => Promise<unknown>;
  flight?: () => void;
};

export function singleFlight(run: () => Promise<unknown>): () => void {
  let running = false;
  let wanted = false;

  const start = (): void => {
    running = true;
    wanted = false;

    void Promise.resolve()
      .then(run)
      .catch(() => {})
      .then(() => {
        running = false;

        if (wanted) {
          start();
        }
      });
  };

  return () => {
    if (running) {
      wanted = true;

      return;
    }

    start();
  };
}

export function inputsRefresh({
  refresh,
  doctor,
  flight = singleFlight(doctor),
}: InputsRefresh): () => Promise<void> {
  return async () => {
    try {
      await refresh();
    } catch {}

    flight();
  };
}
