export function sharedBuild<T>(build: () => Promise<T>): () => Promise<T> {
  let started: Promise<T> | undefined;

  return () => {
    started ??= build();

    return started;
  };
}
