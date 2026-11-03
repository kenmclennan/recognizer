export class Limits {
  retryLimit(): number {
    const env = this.envInt("APP_RETRY_LIMIT", null);
    if (env !== null) {
      return env;
    }
    return this.requiredInt("retry-limit");
  }

  pageSize(): number {
    const env = this.envInt("APP_PAGE_SIZE", null);
    if (env !== null) {
      return env;
    }
    return this.requiredInt("page-size");
  }

  queueDepth(): number {
    const env = this.envInt("APP_QUEUE_DEPTH", null);
    if (env !== null) {
      return env;
    }
    return this.requiredInt("queue-depth");
  }

  idleTimeout(): number {
    const env = this.envInt("APP_IDLE_TIMEOUT", null);
    if (env !== null) {
      return env;
    }
    return this.requiredInt("idle-timeout");
  }
}
