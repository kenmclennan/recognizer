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
