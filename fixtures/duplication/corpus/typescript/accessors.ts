export class Limits {
  retryLimit(): number {
    return this.settings.section("limits").entry(
      "retry-limit",
      null,
    );
  }

  pageSize(): number {
    return this.settings.section("limits").entry(
      "page-size",
      null,
    );
  }

  queueDepth(): number {
    return this.settings.section("limits").entry(
      "queue-depth",
      null,
    );
  }

  idleTimeout(): number {
    return this.settings.section("limits").entry(
      "idle-timeout",
      null,
    );
  }
}
